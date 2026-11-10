import { migrate } from '../db/migrate';
import { closeTestPools, testPool } from '../db/test-pool';
import { PgUserStore } from '../db/user-store';
import { CandidateProfile, EMPTY_PREFERENCES, JobPreferences } from '../profile/profile.schema';
import { ProfileService, ProfileView } from '../profile/profile.service';
import { JobMatcher, matchMessage, MatchError, MatchInput } from './job-matcher';
import { JobStore } from './job-store';
import { JobAnalysis, tidyAnalysis } from './job.schema';
import { JOB_LIMITS, JobsService, MATCH_TIMEOUT_MS, NOTES_MAX, parseApplicationUpdate, parseNewJob } from './jobs.service';

afterAll(closeTestPools);

const PROFILE: CandidateProfile = {
  fullName: 'Jane Doe',
  headline: 'Backend Engineer',
  email: null,
  phone: null,
  location: 'Toronto, ON',
  links: [],
  summary: null,
  yearsExperience: 6,
  skills: ['TypeScript', 'PostgreSQL'],
  workHistory: [],
  education: [],
  certifications: [],
  languages: [],
  workAuthorization: null,
};

const ANALYSIS: JobAnalysis = {
  isJobPosting: true,
  job: {
    title: 'Senior Backend Engineer',
    company: 'Acme',
    location: 'Toronto',
    workMode: 'hybrid',
    employmentType: 'Full-time',
    seniority: 'Senior',
    salary: null,
    yearsRequired: 5,
    requiredSkills: ['TypeScript'],
    niceToHaveSkills: [],
    overview: 'Builds backend APIs.',
    responsibilities: ['Build APIs'],
    benefits: [],
    visaSponsorship: 'not_stated',
    applyUrl: 'https://acme.example/careers/1',
  },
  match: { score: 82, verdict: 'good', summary: 'You fit well.', strengths: ['TypeScript'], gaps: [], dealbreakers: [] },
};

const DESCRIPTION = 'Acme is hiring a Senior Backend Engineer in Toronto. '.repeat(6);

/** The bits of ProfileService the jobs service uses. */
function fakeProfiles(initial: CandidateProfile | null = PROFILE) {
  const state = { profile: initial, parsedAt: null as string | null, editedAt: null as string | null, preferences: EMPTY_PREFERENCES as JobPreferences };
  const profiles = {
    get: async (): Promise<ProfileView> => ({
      status: state.profile ? 'ready' : 'none',
      profile: state.profile,
      sourceFileName: null,
      parsedAt: state.parsedAt,
      editedAt: state.editedAt,
      error: null,
      aiEnabled: true,
    }),
    getPreferences: async () => state.preferences,
  } as unknown as ProfileService;
  return { profiles, state };
}

async function setup(opts: { matcher?: JobMatcher | null; profile?: CandidateProfile | null } = {}) {
  const pool = await testPool();
  await migrate(pool);
  const users = new PgUserStore(pool);
  for (const id of ['u1', 'u2']) await users.upsert({ id, email: `${id}@example.com`, role: 'user', accountStatus: 'active' });
  const seen: MatchInput[] = [];
  const matcher: JobMatcher = { analyse: async (input) => (seen.push(input), ANALYSIS) };
  const { profiles, state } = fakeProfiles(opts.profile === undefined ? PROFILE : opts.profile);
  const store = new JobStore(pool);
  const service = new JobsService(store, profiles, opts.matcher === undefined ? matcher : opts.matcher);
  return { pool, store, service, seen, state };
}

describe('parseNewJob', () => {
  it('accepts a description with or without a link', () => {
    expect(parseNewJob({ description: ` ${DESCRIPTION} ` })).toEqual({ link: null, description: DESCRIPTION.trim() });
    expect(parseNewJob({ link: '4012345678', description: DESCRIPTION }).link).toMatchObject({ source: 'linkedin', externalId: '4012345678' });
    expect(parseNewJob({ link: '  ', description: DESCRIPTION }).link).toBeNull();
  });

  it('rejects a missing, too short or too long description, and a bad link', () => {
    expect(() => parseNewJob({})).toThrow('Paste the job description');
    expect(() => parseNewJob({ description: 'Engineer wanted' })).toThrow(/too short/);
    expect(() => parseNewJob({ description: 'x'.repeat(JOB_LIMITS.descriptionMax + 1) })).toThrow(/too long/);
    expect(() => parseNewJob({ link: 'https://www.linkedin.com/feed/', description: DESCRIPTION })).toThrow(/doesn't point to a job/);
    expect(() => parseNewJob({ link: 42, description: DESCRIPTION })).toThrow('link must be text');
  });
});

describe('tidyAnalysis', () => {
  it('clamps the score, drops an apply link that is not a web link, and caps lists', () => {
    const t = tidyAnalysis({
      ...ANALYSIS,
      job: { ...ANALYSIS.job, applyUrl: 'javascript:alert(1)', requiredSkills: Array.from({ length: 50 }, (_, i) => `s${i}`) },
      match: { ...ANALYSIS.match, score: 140 },
    });
    expect(t.match.score).toBe(100);
    expect(t.job.applyUrl).toBeNull();
    expect(t.job.requiredSkills).toHaveLength(30);
    expect(tidyAnalysis({ ...ANALYSIS, match: { ...ANALYSIS.match, score: -3 } }).match.score).toBe(0);
  });

  it('keeps the posting digest short', () => {
    const many = Array.from({ length: 12 }, (_, i) => `point ${i}`);
    const t = tidyAnalysis({ ...ANALYSIS, job: { ...ANALYSIS.job, responsibilities: many, benefits: many } });
    expect(t.job.responsibilities).toHaveLength(6);
    expect(t.job.benefits).toHaveLength(6);
  });
});

describe('matchMessage', () => {
  it('puts the profile and preferences before the posting, each marked', () => {
    const m = matchMessage({ profile: PROFILE, preferences: EMPTY_PREFERENCES, description: 'THE POSTING' });
    expect(m.indexOf('<candidate_profile>')).toBeLessThan(m.indexOf('<job_preferences>'));
    expect(m.indexOf('<job_preferences>')).toBeLessThan(m.indexOf('<job_posting>\nTHE POSTING\n</job_posting>'));
  });
});

describe('JobsService', () => {
  it('adds a job, matches it in the background, and shows it only to its owner', async () => {
    const { service, seen } = await setup();
    const added = await service.add('u1', parseNewJob({ link: 'https://www.linkedin.com/jobs/view/4012345678/', description: DESCRIPTION }));
    expect(added).toMatchObject({ source: 'linkedin', url: 'https://www.linkedin.com/jobs/view/4012345678/', matchStatus: 'matching', score: null });
    await service.whenIdle();

    const job = await service.get('u1', added.id);
    expect(job).toMatchObject({ matchStatus: 'ready', title: 'Senior Backend Engineer', company: 'Acme', score: 82, verdict: 'good', profileChanged: false });
    expect(job.details?.applyUrl).toBe('https://acme.example/careers/1');
    expect(seen[0]).toMatchObject({ profile: PROFILE, preferences: EMPTY_PREFERENCES, description: DESCRIPTION.trim() });
    expect(await service.list('u1')).toHaveLength(1);
    expect(await service.list('u2')).toEqual([]);
    await expect(service.get('u2', added.id)).rejects.toThrow('Job not found');
    await expect(service.delete('u2', added.id)).rejects.toThrow('Job not found');
  });

  it('refuses the same LinkedIn or Indeed job twice, naming the one already added', async () => {
    const { service } = await setup();
    const first = await service.add('u1', parseNewJob({ link: '4012345678', description: DESCRIPTION }));
    const again = await service.add('u1', parseNewJob({ link: 'https://www.linkedin.com/jobs/search/?currentJobId=4012345678', description: DESCRIPTION })).catch((e) => e);
    expect(again.getStatus()).toBe(409);
    expect(again.getResponse()).toMatchObject({ jobId: first.id });
    // Another user may add the same job; pasted jobs without a link are never treated as duplicates.
    await expect(service.add('u2', parseNewJob({ link: '4012345678', description: DESCRIPTION }))).resolves.toBeDefined();
    await service.add('u1', parseNewJob({ description: DESCRIPTION }));
    await service.add('u1', parseNewJob({ description: DESCRIPTION }));
    await service.whenIdle();
  });

  it('needs a profile, and AI to be set up', async () => {
    await expect((await setup({ profile: null })).service.add('u1', parseNewJob({ description: DESCRIPTION }))).rejects.toThrow(/Set up your profile/);
    await expect((await setup({ matcher: null })).service.add('u1', parseNewJob({ description: DESCRIPTION }))).rejects.toThrow(/isn't set up/);
  });

  it('limits how many jobs can be added a day', async () => {
    const { service, pool } = await setup();
    for (let i = 0; i < JOB_LIMITS.perDay; i++) {
      await pool.query(`INSERT INTO job (id, user_id, source, description, match_status) VALUES ($1, 'u1', 'pasted', 'x', 'ready')`, [`j${i}`]);
    }
    const err = await service.add('u1', parseNewJob({ description: DESCRIPTION })).catch((e) => e);
    expect(err.getStatus()).toBe(429);
    // Older jobs don't count towards the day.
    await pool.query(`UPDATE job SET created_at = $1`, [new Date(Date.now() - 2 * 24 * 60 * 60_000)]);
    await expect(service.add('u1', parseNewJob({ description: DESCRIPTION }))).resolves.toBeDefined();
    await service.whenIdle();
  });

  it('keeps the previous result when a re-match fails, with a safe message', async () => {
    let fail: Error | null = null;
    let hold: Promise<void> = Promise.resolve();
    const matcher: JobMatcher = {
      analyse: async () => {
        await hold;
        if (fail) throw fail;
        return ANALYSIS;
      },
    };
    const { service } = await setup({ matcher });
    const { id } = await service.add('u1', parseNewJob({ description: DESCRIPTION }));
    await service.whenIdle();

    fail = new MatchError('The AI service is busy. Please try again in a few minutes.');
    let release!: () => void;
    hold = new Promise((r) => (release = r));
    expect((await service.rematch('u1', id)).matchStatus).toBe('matching');
    await expect(service.rematch('u1', id)).rejects.toThrow(/already being matched/);
    release();
    await service.whenIdle();
    expect(await service.get('u1', id)).toMatchObject({ matchStatus: 'failed', matchError: fail.message, score: 82 });

    fail = new Error('socket hang up: secret details');
    await service.rematch('u1', id);
    await service.whenIdle();
    expect((await service.get('u1', id)).matchError).toBe('Something went wrong matching this job. Please try again.');
  });

  it('says when the profile changed after matching', async () => {
    const { service, state } = await setup();
    const { id } = await service.add('u1', parseNewJob({ description: DESCRIPTION }));
    await service.whenIdle();
    state.editedAt = new Date(Date.now() + 1000).toISOString();
    expect((await service.get('u1', id)).profileChanged).toBe(true);
  });

  it('does not let a superseded matching overwrite a newer one, and treats a stuck one as failed', async () => {
    const { service, store, pool } = await setup();
    const { id } = await service.add('u1', parseNewJob({ description: DESCRIPTION }));
    await service.whenIdle();
    expect(await store.startMatch('u1', id, 'run-new', new Date(0))).toBe(true);
    expect(await store.startMatch('u1', id, 'run-other', new Date(0))).toBe(false);
    expect(await store.finishMatch('u1', id, 'run-old', ANALYSIS.job, ANALYSIS.match)).toBe(false);

    await pool.query('UPDATE job SET updated_at = $1', [new Date(Date.now() - MATCH_TIMEOUT_MS - 1000)]);
    expect(await service.get('u1', id)).toMatchObject({ matchStatus: 'failed', matchError: expect.stringMatching(/took too long/) });
    expect((await service.rematch('u1', id)).matchStatus).toBe('matching');
    await service.whenIdle();
    expect((await service.get('u1', id)).matchStatus).toBe('ready');
  });

  it('deletes a job', async () => {
    const { service } = await setup();
    const { id } = await service.add('u1', parseNewJob({ description: DESCRIPTION }));
    await service.whenIdle();
    await service.delete('u1', id);
    expect(await service.list('u1')).toEqual([]);
  });

  it('tracks the application: status changes on a timeline, and private notes', async () => {
    const { service } = await setup();
    const { id } = await service.add('u1', { link: null, description: DESCRIPTION });
    await service.whenIdle();
    const fresh = await service.get('u1', id);
    expect(fresh).toMatchObject({ applicationStatus: 'saved', statusChangedAt: null, notes: null });
    expect(fresh.timeline.map((t) => t.status)).toEqual(['saved']);

    await service.updateApplication('u1', id, { status: 'applied', notes: 'Sent the tailored resume' });
    await service.updateApplication('u1', id, { status: 'applied' }); // no change: not logged twice
    const view = await service.updateApplication('u1', id, { status: 'interviewing' });
    expect(view).toMatchObject({ applicationStatus: 'interviewing', notes: 'Sent the tailored resume' });
    expect(view.statusChangedAt).not.toBeNull();
    expect(view.timeline.map((t) => t.status)).toEqual(['saved', 'applied', 'interviewing']);
    expect((await service.list('u1'))[0]).toMatchObject({ applicationStatus: 'interviewing' });

    expect((await service.updateApplication('u1', id, { notes: null })).notes).toBeNull();
    await expect(service.updateApplication('u2', id, { status: 'offer' })).rejects.toThrow('Job not found');
    expect((await service.get('u1', id)).applicationStatus).toBe('interviewing');
  });
});

describe('parseApplicationUpdate', () => {
  it('accepts a status and/or notes, and rejects anything else', () => {
    expect(parseApplicationUpdate({ status: 'offer' })).toEqual({ status: 'offer' });
    expect(parseApplicationUpdate({ notes: '  Call Tuesday ' })).toEqual({ notes: 'Call Tuesday' });
    expect(parseApplicationUpdate({ notes: '   ' })).toEqual({ notes: null });
    expect(() => parseApplicationUpdate({ status: 'hired' })).toThrow('status must be one of');
    expect(() => parseApplicationUpdate({ notes: 5 })).toThrow('notes must be text');
    expect(() => parseApplicationUpdate({ notes: 'x'.repeat(NOTES_MAX + 1) })).toThrow('Keep notes under');
    expect(() => parseApplicationUpdate({})).toThrow('Send a status or notes');
  });
});
