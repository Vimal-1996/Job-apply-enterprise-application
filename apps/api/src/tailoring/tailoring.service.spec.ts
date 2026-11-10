import JSZip from 'jszip';
import { migrate } from '../db/migrate';
import { closeTestPools, testPool } from '../db/test-pool';
import { PgUserStore } from '../db/user-store';
import { JobMatcher } from '../jobs/job-matcher';
import { JobStore } from '../jobs/job-store';
import { JobAnalysis } from '../jobs/job.schema';
import { JobsService } from '../jobs/jobs.service';
import { CandidateProfile, EMPTY_PREFERENCES } from '../profile/profile.schema';
import { ProfileService, ProfileView } from '../profile/profile.service';
import { DraftStore } from './draft-store';
import { profileForPrompt, ResumeTailor, TailorError, tailorMessage } from './resume-tailor';
import { buildResumeDocx, formatMonth, resumeFileName } from './resume-docx';
import { applySuggestions, parseDecisions, RawSuggestion, Suggestion, TAILORING_LIMITS, tidySuggestions } from './tailoring.schema';
import { TAILOR_TIMEOUT_MS, TailoringService } from './tailoring.service';

afterAll(closeTestPools);

const PROFILE: CandidateProfile = {
  fullName: 'Jane Doe',
  headline: 'Backend Engineer',
  email: 'jane@example.com',
  phone: null,
  location: 'Toronto, ON',
  links: ['https://github.com/jane'],
  summary: 'Engineer who builds APIs.',
  yearsExperience: 6,
  skills: ['TypeScript', 'Postgres'],
  workHistory: [
    {
      title: 'Backend Engineer',
      company: 'Globex',
      location: 'Toronto',
      startDate: '2021-03',
      endDate: null,
      current: true,
      highlights: ['Built the billing API', 'Ran AWS message queues'],
    },
    { title: 'Developer', company: 'Initech', location: null, startDate: '2018', endDate: '2021-02', current: false, highlights: ['Wrote reports'] },
  ],
  education: [{ institution: 'University of Toronto', degree: 'BSc', field: 'Computer Science', endYear: 2018 }],
  certifications: [],
  languages: ['English'],
  workAuthorization: null,
};

const raw = (r: Partial<RawSuggestion>): RawSuggestion => ({
  kind: 'add_skill',
  workIndex: null,
  bulletIndex: null,
  after: 'x',
  reason: 'Because the posting asks for it.',
  source: 'resume',
  question: null,
  ...r,
});

let n = 0;
const ids = () => `s${++n}`;

describe('tidySuggestions', () => {
  it('fills "before" from the profile, and drops bad positions, known skills and no-op changes', () => {
    const out = tidySuggestions(
      PROFILE,
      [
        raw({ kind: 'summary', after: 'Backend engineer with 6 years of TypeScript and PostgreSQL.' }),
        raw({ kind: 'rewrite_bullet', workIndex: 0, bulletIndex: 1, after: 'Ran AWS SQS message queues' }),
        raw({ kind: 'rewrite_bullet', workIndex: 0, bulletIndex: 9, after: 'No such bullet' }),
        raw({ kind: 'add_bullet', workIndex: 7, after: 'No such role' }),
        raw({ kind: 'add_skill', after: 'typescript' }), // already listed
        raw({ kind: 'add_skill', after: 'PostgreSQL' }),
        raw({ kind: 'headline', after: ' Backend  Engineer ' }), // same as now
        raw({ kind: 'add_skill', after: 'Kubernetes', source: 'needs_confirmation', question: 'Have you used Kubernetes?' }),
      ],
      ids,
    );
    expect(out.map((s) => [s.kind, s.before, s.after])).toEqual([
      ['summary', 'Engineer who builds APIs.', 'Backend engineer with 6 years of TypeScript and PostgreSQL.'],
      ['rewrite_bullet', 'Ran AWS message queues', 'Ran AWS SQS message queues'],
      ['add_skill', null, 'PostgreSQL'],
      ['add_skill', null, 'Kubernetes'],
    ]);
    expect(out.every((s) => s.decision === 'pending' && s.editedText === null)).toBe(true);
    expect(out[3]).toMatchObject({ source: 'needs_confirmation', question: 'Have you used Kubernetes?' });
    expect(out[0].question).toBeNull();
  });

  it('caps the number of suggestions', () => {
    const many = Array.from({ length: 30 }, (_, i) => raw({ after: `Skill ${i}` }));
    expect(tidySuggestions(PROFILE, many, ids)).toHaveLength(TAILORING_LIMITS.suggestions);
  });
});

describe('applySuggestions', () => {
  const s = (over: Partial<Suggestion>): Suggestion => ({
    id: ids(),
    kind: 'add_skill',
    workIndex: null,
    bulletIndex: null,
    before: null,
    after: 'x',
    reason: '',
    source: 'resume',
    question: null,
    decision: 'accepted',
    editedText: null,
    ...over,
  });

  it('applies only accepted suggestions, preferring the user\'s edit, and never changes the base', () => {
    const base = structuredClone(PROFILE);
    const out = applySuggestions(base, [
      s({ kind: 'summary', after: 'New summary' }),
      s({ kind: 'headline', after: 'Senior Backend Engineer', decision: 'rejected' }),
      s({ kind: 'add_skill', after: 'Kubernetes', decision: 'pending' }),
      s({ kind: 'add_skill', after: 'PostgreSQL' }),
      s({ kind: 'add_bullet', workIndex: 0, after: 'Added bullet' }),
      s({ kind: 'rewrite_bullet', workIndex: 0, bulletIndex: 1, after: 'Ran AWS SQS', editedText: 'Ran AWS SQS queues for billing' }),
    ]);
    expect(out.summary).toBe('New summary');
    expect(out.headline).toBe('Backend Engineer');
    expect(out.skills).toEqual(['TypeScript', 'Postgres', 'PostgreSQL']);
    expect(out.workHistory[0].highlights).toEqual(['Built the billing API', 'Ran AWS SQS queues for billing', 'Added bullet']);
    expect(base).toEqual(PROFILE);
  });
});

describe('parseDecisions', () => {
  it('accepts decisions with optional edits and rejects bad input', () => {
    expect(parseDecisions({ decisions: [{ id: 'a', decision: 'accepted', editedText: '  New  text ' }] })).toEqual([
      { id: 'a', decision: 'accepted', editedText: 'New text' },
    ]);
    expect(parseDecisions({ decisions: [{ id: 'a', decision: 'rejected' }] })).toEqual([{ id: 'a', decision: 'rejected', editedText: undefined }]);
    expect(parseDecisions({})).toHaveProperty('error');
    expect(parseDecisions({ decisions: [{ id: 'a', decision: 'maybe' }] })).toHaveProperty('error');
    expect(parseDecisions({ decisions: [{ id: 'a', decision: 'accepted', editedText: '   ' }] })).toHaveProperty('error');
    expect(parseDecisions({ decisions: [{ id: 'a', decision: 'accepted', editedText: 'x'.repeat(1001) }] })).toHaveProperty('error');
  });
});

describe('the prompt', () => {
  it('numbers roles and bullets so suggestions can point at them, and marks each part', () => {
    const p = profileForPrompt(PROFILE);
    expect(p).toContain('Role 0: Backend Engineer at Globex (2021-03 – present)');
    expect(p).toContain('Bullet 0.1: Ran AWS message queues');
    expect(p).toContain('Role 1: Developer at Initech');
    const m = tailorMessage({ profile: PROFILE, job: ANALYSIS.job, match: ANALYSIS.match, description: 'THE POSTING' });
    expect(m.indexOf('<candidate_profile>')).toBeLessThan(m.indexOf('<job_posting>\nTHE POSTING\n</job_posting>'));
    expect(m).toContain('<match>');
  });
});

describe('the Word resume', () => {
  it('has the standard sections and the profile text, in one column with no tables', async () => {
    const bytes = await buildResumeDocx(PROFILE);
    const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string');
    const text = xml.replace(/<[^>]+>/g, ' ');
    for (const t of ['Jane Doe', 'SUMMARY', 'SKILLS', 'EXPERIENCE', 'EDUCATION', 'Built the billing API', 'Mar 2021', 'Present', 'University of Toronto']) {
      expect(text).toContain(t);
    }
    expect(xml).not.toContain('<w:tbl>');
    expect(xml).not.toContain('<w:txbxContent>');
  });

  it('formats dates and file names safely', () => {
    expect(formatMonth('2021-03')).toBe('Mar 2021');
    expect(formatMonth('2018')).toBe('2018');
    expect(resumeFileName('Jane Doe', 'Acme / Corp')).toBe('Jane Doe - Acme Corp resume.docx');
    expect(resumeFileName(null, null)).toBe('Tailored resume.docx');
  });
});

// ---------------------------------------------------------------- service

const ANALYSIS: JobAnalysis = {
  isJobPosting: true,
  job: {
    title: 'Senior Backend Engineer',
    overview: 'Builds payment APIs.',
    responsibilities: [],
    benefits: [],
    company: 'Acme',
    location: 'Remote',
    workMode: 'remote',
    employmentType: null,
    seniority: 'Senior',
    salary: null,
    yearsRequired: 5,
    requiredSkills: ['TypeScript', 'PostgreSQL', 'SQS'],
    niceToHaveSkills: ['Kubernetes'],
    visaSponsorship: 'not_stated',
    applyUrl: null,
  },
  match: { score: 80, verdict: 'good', summary: 'Good fit.', strengths: [], gaps: ['Kubernetes not shown'], dealbreakers: [] },
};
const DESCRIPTION = 'Acme is hiring a Senior Backend Engineer to build payment APIs. '.repeat(5);

function fakeProfiles() {
  const state = { profile: PROFILE as CandidateProfile | null, editedAt: null as string | null };
  const profiles = {
    get: async (): Promise<ProfileView> => ({
      status: state.profile ? 'ready' : 'none',
      profile: state.profile,
      sourceFileName: null,
      parsedAt: null,
      editedAt: state.editedAt,
      error: null,
      aiEnabled: true,
    }),
    getPreferences: async () => EMPTY_PREFERENCES,
  } as unknown as ProfileService;
  return { profiles, state };
}

function fakeTailor() {
  const calls: unknown[] = [];
  let next: () => Promise<RawSuggestion[]> = async () => [
    raw({ kind: 'summary', after: 'Backend engineer focused on payments.' }),
    raw({ kind: 'add_skill', after: 'PostgreSQL' }),
    raw({ kind: 'add_skill', after: 'Kubernetes', source: 'needs_confirmation', question: 'Have you used Kubernetes?' }),
  ];
  const tailor: ResumeTailor = { suggest: async (input) => (calls.push(input), next()) };
  return { tailor, calls, willFail: (e: Error) => (next = async () => Promise.reject(e)) };
}

async function setup(opts: { ai?: boolean } = {}) {
  const pool = await testPool();
  await migrate(pool);
  const users = new PgUserStore(pool);
  for (const id of ['u1', 'u2']) await users.upsert({ id, email: `${id}@example.com`, role: 'user', accountStatus: 'active' });
  const { profiles, state } = fakeProfiles();
  const matcher: JobMatcher = { analyse: async () => ANALYSIS };
  const jobs = new JobsService(new JobStore(pool), profiles, matcher);
  const fake = fakeTailor();
  const store = new DraftStore(pool);
  const service = new TailoringService(store, jobs, profiles, opts.ai === false ? null : fake.tailor);
  const addJob = async (userId = 'u1') => {
    const job = await jobs.add(userId, { link: null, description: DESCRIPTION });
    await jobs.whenIdle();
    return job.id;
  };
  return { pool, service, store, jobs, fake, state, addJob };
}

describe('TailoringService', () => {
  it('suggests changes, saves decisions, and builds the resume from accepted ones only', async () => {
    const { service, fake, addJob } = await setup();
    const jobId = await addJob();
    expect(await service.get('u1', jobId)).toMatchObject({ status: 'none', suggestions: [], aiEnabled: true });

    await service.start('u1', jobId);
    await service.whenIdle();
    const view = await service.get('u1', jobId);
    expect(view.status).toBe('ready');
    expect(view.suggestions.map((s) => s.after)).toEqual(['Backend engineer focused on payments.', 'PostgreSQL', 'Kubernetes']);
    expect(fake.calls[0]).toMatchObject({ profile: PROFILE, job: ANALYSIS.job, description: DESCRIPTION });

    const [summary, pg, k8s] = view.suggestions;
    const decided = await service.decide('u1', jobId, [
      { id: summary.id, decision: 'accepted', editedText: 'Backend engineer building payment APIs.' },
      { id: pg.id, decision: 'accepted' },
      { id: k8s.id, decision: 'rejected' },
    ]);
    expect(decided.suggestions.map((s) => s.decision)).toEqual(['accepted', 'accepted', 'rejected']);

    const { fileName, bytes } = await service.document('u1', jobId);
    expect(fileName).toBe('Jane Doe - Acme resume.docx');
    const text = (await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string')).replace(/<[^>]+>/g, '');
    expect(text).toContain('Backend engineer building payment APIs.');
    expect(text).toContain('PostgreSQL');
    expect(text).not.toContain('Kubernetes');
    expect(text).not.toContain('Engineer who builds APIs.');
  });

  it('keeps it to the owner, and refuses unknown suggestions or a second run at once', async () => {
    const { service, fake, addJob } = await setup();
    const jobId = await addJob();
    await expect(service.get('u2', jobId)).rejects.toThrow('Job not found');
    await expect(service.start('u2', jobId)).rejects.toThrow('Job not found');
    await expect(service.decide('u1', jobId, [{ id: 'x', decision: 'accepted' }])).rejects.toThrow('no suggestions');
    await expect(service.document('u1', jobId)).rejects.toThrow('suggestions for this job first');

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const original = fake.tailor.suggest;
    fake.tailor.suggest = async (input) => (await gate, original(input));
    expect((await service.start('u1', jobId)).status).toBe('suggesting');
    await expect(service.start('u1', jobId)).rejects.toThrow('already being made');
    release();
    await service.whenIdle();
    await expect(service.decide('u1', jobId, [{ id: 'nope', decision: 'accepted' }])).rejects.toThrow('Unknown suggestion');
  });

  it('keeps the previous suggestions when a new run fails, with a safe message', async () => {
    const { service, fake, addJob } = await setup();
    const jobId = await addJob();
    await service.start('u1', jobId);
    await service.whenIdle();
    fake.willFail(new TailorError('The AI service is busy. Please try again in a few minutes.'));
    await service.start('u1', jobId);
    await service.whenIdle();
    const view = await service.get('u1', jobId);
    expect(view).toMatchObject({ status: 'failed', error: 'The AI service is busy. Please try again in a few minutes.' });
    expect(view.suggestions).toHaveLength(3);

    fake.willFail(new Error('socket hang up: internal detail'));
    await service.start('u1', jobId);
    await service.whenIdle();
    expect((await service.get('u1', jobId)).error).toBe('Something went wrong making suggestions. Please try again.');
  });

  it('treats a stuck run as failed so it can be retried', async () => {
    const { service, pool, addJob } = await setup();
    const jobId = await addJob();
    await service.start('u1', jobId);
    await service.whenIdle();
    await pool.query("UPDATE resume_draft SET status = 'suggesting', run_id = 'old', updated_at = $1", [new Date(Date.now() - TAILOR_TIMEOUT_MS - 1000)]);
    expect((await service.get('u1', jobId)).status).toBe('failed');
    expect(['suggesting', 'ready']).toContain((await service.start('u1', jobId)).status);
    await service.whenIdle();
  });

  it('notes when the profile changed after the suggestions were made', async () => {
    const { service, state, addJob } = await setup();
    const jobId = await addJob();
    await service.start('u1', jobId);
    await service.whenIdle();
    expect((await service.get('u1', jobId)).profileChanged).toBe(false);
    state.editedAt = new Date(Date.now() + 1000).toISOString();
    expect((await service.get('u1', jobId)).profileChanged).toBe(true);
  });

  it('needs AI, a matched job and a profile, and caps runs per day', async () => {
    const off = await setup({ ai: false });
    const offJob = await off.addJob();
    expect((await off.service.get('u1', offJob)).aiEnabled).toBe(false);
    await expect(off.service.start('u1', offJob)).rejects.toThrow("isn't set up");

    const { service, state, pool, addJob } = await setup();
    const jobId = await addJob();
    state.profile = null;
    await expect(service.start('u1', jobId)).rejects.toThrow('Set up your profile first');
    state.profile = PROFILE;

    for (let i = 0; i < TAILORING_LIMITS.perDay; i++) await pool.query("INSERT INTO tailoring_run (user_id) VALUES ('u1')");
    await expect(service.start('u1', jobId)).rejects.toThrow('up to 20 resumes a day');
  });

  it('saves decisions only against the current set of suggestions', async () => {
    const { service, store, addJob } = await setup();
    const jobId = await addJob();
    await service.start('u1', jobId);
    await service.whenIdle();
    const first = (await store.get('u1', jobId))!;
    await service.start('u1', jobId); // a new set replaces the first
    await service.whenIdle();
    const second = (await store.get('u1', jobId))!;
    expect(second.suggestionsId).not.toBe(first.suggestionsId);
    expect(await store.saveSuggestions('u1', jobId, first.suggestionsId!, first.suggestions!)).toBe(false);
    expect(await store.saveSuggestions('u1', jobId, second.suggestionsId!, second.suggestions!)).toBe(true);
  });

  it('is removed with its job', async () => {
    const { service, jobs, store, addJob } = await setup();
    const jobId = await addJob();
    await service.start('u1', jobId);
    await service.whenIdle();
    await jobs.delete('u1', jobId);
    expect(await store.get('u1', jobId)).toBeNull();
  });
});
