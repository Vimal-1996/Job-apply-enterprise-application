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
import { GapInput, gapMessage, profileForPrompt, ResumeTailor, TailorError, tailorMessage } from './resume-tailor';
import {
  applySuggestions,
  GapWriting,
  gapsFrom,
  gapSuggestions,
  parseDecisions,
  parseGapAnswer,
  RawSuggestion,
  Suggestion,
  TAILORING_LIMITS,
  tidySuggestions,
} from './tailoring.schema';
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
        raw({ kind: 'add_skill', after: 'Kubernetes', source: 'needs_confirmation', question: 'Have you used Kubernetes?' }), // asked as a gap instead
      ],
      ids,
    );
    expect(out.map((s) => [s.kind, s.before, s.after])).toEqual([
      ['summary', 'Engineer who builds APIs.', 'Backend engineer with 6 years of TypeScript and PostgreSQL.'],
      ['rewrite_bullet', 'Ran AWS message queues', 'Ran AWS SQS message queues'],
      ['add_skill', null, 'PostgreSQL'],
    ]);
    expect(out.every((s) => s.decision === 'pending' && s.editedText === null && s.source === 'resume' && s.question === null)).toBe(true);
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
    raw({ kind: 'add_skill', after: 'Kubernetes' }),
  ];
  const gapCalls: GapInput[] = [];
  let gapResult: GapWriting = { bullets: ['Ran Kubernetes clusters for 12 services'], skills: ['Kubernetes', 'Helm'], problem: null };
  const tailor: ResumeTailor = {
    suggest: async (input) => (calls.push(input), next()),
    writeGap: async (input) => (gapCalls.push(input), gapResult),
  };
  return {
    tailor,
    calls,
    gapCalls,
    willFail: (e: Error) => (next = async () => Promise.reject(e)),
    gapWrites: (w: GapWriting) => (gapResult = w),
  };
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

describe('gaps', () => {
  it('lists the job gaps once each, capped', () => {
    const gaps = gapsFrom(['Kubernetes not shown', ' kubernetes  NOT shown ', '', ...Array.from({ length: 20 }, (_, i) => `Gap ${i}`)], ids);
    expect(gaps[0]).toMatchObject({ text: 'Kubernetes not shown', answer: 'pending', experience: null, workIndex: null });
    expect(gaps).toHaveLength(TAILORING_LIMITS.gaps);
  });

  it('turns a write-up into accepted changes: bullets only with a role, no skills already listed', () => {
    const gap = gapsFrom(['Kubernetes not shown'], ids)[0];
    const w: GapWriting = { bullets: ['Ran Kubernetes clusters', ' ', 'Two', 'Three'], skills: ['Kubernetes', 'TypeScript', 'Helm', 'A', 'B'], problem: null };
    const out = gapSuggestions(PROFILE, gap, 0, w, ids);
    expect(out.map((x) => [x.kind, x.workIndex, x.after])).toEqual([
      ['add_bullet', 0, 'Ran Kubernetes clusters'],
      ['add_bullet', 0, 'Two'],
      ['add_skill', null, 'Kubernetes'],
      ['add_skill', null, 'Helm'],
      ['add_skill', null, 'A'],
    ]);
    expect(out.every((x) => x.decision === 'accepted' && x.source === 'experience' && x.gapId === gap.id)).toBe(true);
    expect(gapSuggestions(PROFILE, gap, null, w, ids).every((x) => x.kind === 'add_skill')).toBe(true);
    expect(gapSuggestions(PROFILE, gap, 7, w, ids).every((x) => x.kind === 'add_skill')).toBe(true);
  });

  it('validates answers', () => {
    expect(parseGapAnswer({ answer: 'no' })).toEqual({ answer: 'no' });
    expect(parseGapAnswer({ answer: 'yes', experience: '  Ran our Kubernetes clusters at Globex for two years. ', workIndex: 0 })).toEqual({
      answer: 'yes',
      experience: 'Ran our Kubernetes clusters at Globex for two years.',
      workIndex: 0,
    });
    expect(parseGapAnswer({ answer: 'yes', experience: 'yes', workIndex: 0 })).toHaveProperty('error');
    expect(parseGapAnswer({ answer: 'yes', experience: 'x'.repeat(2000), workIndex: 0 })).toHaveProperty('error');
    expect(parseGapAnswer({ answer: 'yes', experience: 'Ran clusters for two years', workIndex: -1 })).toHaveProperty('error');
    expect(parseGapAnswer({ answer: 'maybe' })).toHaveProperty('error');
  });

  it("puts the gap, the role and the user's words in the prompt", () => {
    const gap = gapsFrom(['Kubernetes not shown'], ids)[0];
    const m = gapMessage({ profile: PROFILE, job: ANALYSIS.job, gap, experience: 'Ran clusters', workIndex: 0 });
    expect(m).toContain('<gap>Kubernetes not shown</gap>');
    expect(m).toContain(`<role>${PROFILE.workHistory[0].title} at ${PROFILE.workHistory[0].company}`);
    expect(m).toContain('<my_experience>\nRan clusters\n</my_experience>');
  });
});

describe('TailoringService', () => {
  it('asks about the job gaps; "yes" writes the experience up as accepted changes, "no" removes them', async () => {
    const { service, fake, addJob } = await setup();
    const jobId = await addJob();
    await service.start('u1', jobId);
    await service.whenIdle();
    const view = await service.get('u1', jobId);
    expect(view.gaps).toEqual([expect.objectContaining({ text: 'Kubernetes not shown', answer: 'pending' })]);
    const gapId = view.gaps[0].id;

    await expect(service.answerGap('u1', jobId, 'nope', { answer: 'no' })).rejects.toThrow('Unknown gap');
    await expect(service.answerGap('u1', jobId, gapId, { answer: 'yes', experience: 'Ran clusters at Globex', workIndex: 9 })).rejects.toThrow('Pick one of your roles');

    const yes = await service.answerGap('u1', jobId, gapId, { answer: 'yes', experience: 'Ran our Kubernetes clusters at Globex', workIndex: 0 });
    expect(fake.gapCalls[0]).toMatchObject({ experience: 'Ran our Kubernetes clusters at Globex', workIndex: 0, gap: { text: 'Kubernetes not shown' } });
    expect(yes.gaps[0]).toMatchObject({ answer: 'yes', experience: 'Ran our Kubernetes clusters at Globex', workIndex: 0 });
    // Kubernetes is already suggested from the resume but not accepted, so the gap adds it.
    const fromGap = yes.suggestions.filter((x) => x.gapId === gapId);
    expect(fromGap.map((x) => x.after)).toEqual(['Ran Kubernetes clusters for 12 services', 'Kubernetes', 'Helm']);
    const { bytes } = await service.document('u1', jobId);
    expect(await docText(bytes)).toContain('Ran Kubernetes clusters for 12 services');

    // Answering again replaces what it wrote; "no" takes it all out.
    fake.gapWrites({ bullets: [], skills: [], problem: 'Say where you used Kubernetes.' });
    await expect(service.answerGap('u1', jobId, gapId, { answer: 'yes', experience: 'I want to learn it soon', workIndex: 0 })).rejects.toThrow(
      'Say where you used Kubernetes.',
    );
    const no = await service.answerGap('u1', jobId, gapId, { answer: 'no' });
    expect(no.gaps[0]).toMatchObject({ answer: 'no', experience: null });
    expect(no.suggestions.some((x) => x.gapId)).toBe(false);
  });

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

  it('builds the Workday layout, with profile fixes made after the suggestions, and lists what is missing', async () => {
    const { service, state, addJob } = await setup();
    const jobId = await addJob();
    await service.start('u1', jobId);
    await service.whenIdle();
    const view = await service.get('u1', jobId);
    expect(view.checks.map((c) => c.message)).toContain('Add a phone number: Workday asks for one.');
    await service.decide('u1', jobId, [{ id: view.suggestions[0].id, decision: 'accepted' }]);

    // The user fixes their phone and a start month on the Profile page afterwards.
    state.profile = {
      ...PROFILE,
      phone: '+1 416 555 0100',
      workHistory: [PROFILE.workHistory[0], { ...PROFILE.workHistory[1], startDate: '2018-06' }],
    };
    expect((await service.get('u1', jobId)).checks.map((c) => c.message)).not.toContain('Add a phone number: Workday asks for one.');
    const { bytes } = await service.document('u1', jobId, 'workday');
    const text = (await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string')).replace(/<[^>]+>/g, '\n');
    expect(text).toContain('WORK EXPERIENCE');
    expect(text).toContain('+1 416 555 0100');
    expect(text).toContain('06/2018 - 02/2021');
    expect(text).toContain('Backend engineer focused on payments.'); // the accepted tailored summary
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

async function docText(bytes: Buffer): Promise<string> {
  return (await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string')).replace(/<[^>]+>/g, '');
}
