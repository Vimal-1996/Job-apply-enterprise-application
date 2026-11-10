import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TOKEN_VERIFIER } from '../src/auth/auth.types';
import { USER_DIRECTORY } from '../src/admin/users/user.types';
import { PG_POOL } from '../src/db/database.module';
import { PgUserStore } from '../src/db/user-store';
import { JOB_MATCHER, JobMatcher } from '../src/jobs/job-matcher';
import { JobAnalysis } from '../src/jobs/job.schema';
import { JobsService } from '../src/jobs/jobs.service';
import { CandidateProfile } from '../src/profile/profile.schema';
import { RESUME_TAILOR, ResumeTailor } from '../src/tailoring/resume-tailor';
import { TailoringService } from '../src/tailoring/tailoring.service';
import { detail, fakeDirectory, fakeVerifier } from './fakes';

const TOKENS = {
  'jane-token': { sub: 'u-jane', client_id: 'c', 'cognito:groups': ['user'] },
  'bob-token': { sub: 'u-bob', client_id: 'c', 'cognito:groups': ['user'] },
};

const PROFILE: CandidateProfile = {
  fullName: 'Jane Doe',
  headline: 'Backend Engineer',
  email: 'jane@example.com',
  phone: null,
  location: 'Toronto, ON',
  links: [],
  summary: 'Builds APIs.',
  yearsExperience: 6,
  skills: ['TypeScript'],
  workHistory: [{ title: 'Engineer', company: 'Globex', location: null, startDate: '2021', endDate: null, current: true, highlights: ['Built APIs'] }],
  education: [],
  certifications: [],
  languages: [],
  workAuthorization: null,
};

const ANALYSIS: JobAnalysis = {
  isJobPosting: true,
  job: {
    title: 'Backend Engineer',
    company: 'Acme',
    location: null,
    workMode: null,
    employmentType: null,
    seniority: null,
    salary: null,
    yearsRequired: null,
    requiredSkills: ['TypeScript', 'PostgreSQL'],
    niceToHaveSkills: [],
    overview: 'Builds backend APIs.',
    responsibilities: [],
    benefits: [],
    visaSponsorship: 'not_stated',
    applyUrl: null,
  },
  match: { score: 70, verdict: 'good', summary: 'Good.', strengths: [], gaps: ['Kubernetes not shown in your profile'], dealbreakers: [] },
};

const DESCRIPTION = 'Acme is hiring a Backend Engineer to build TypeScript and PostgreSQL services. '.repeat(4);

describe('resume tailoring (e2e)', () => {
  let app: INestApplication;
  // Scores higher when the resume mentions PostgreSQL, like a real match would.
  const matcher: JobMatcher = {
    analyse: async ({ profile }) => {
      const pg = profile.skills.includes('PostgreSQL');
      return { ...ANALYSIS, match: { ...ANALYSIS.match, score: pg ? 82 : 70, summary: pg ? 'Covers the stack.' : 'Good.' } };
    },
  };
  const tailor: ResumeTailor = {
    suggest: async () => [
      { kind: 'add_skill', workIndex: null, bulletIndex: null, after: 'PostgreSQL', reason: 'The posting requires it.', source: 'resume', question: null },
      { kind: 'rewrite_bullet', workIndex: 0, bulletIndex: 0, after: 'Built TypeScript APIs', reason: 'Names the stack.', source: 'resume', question: null },
    ],
    writeGap: async () => ({ bullets: ['Ran Kubernetes clusters'], skills: ['Kubernetes'], problem: null }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(fakeVerifier(TOKENS))
      .overrideProvider(USER_DIRECTORY)
      .useValue(fakeDirectory([detail('u-jane'), detail('u-bob')]))
      .overrideProvider(JOB_MATCHER)
      .useValue(matcher)
      .overrideProvider(RESUME_TAILOR)
      .useValue(tailor)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const users = new PgUserStore(app.get(PG_POOL));
    for (const id of ['u-jane', 'u-bob']) await users.upsert({ id, email: `${id}@example.com`, role: 'user', accountStatus: 'active' });
  });

  afterAll(() => app.close());

  const as = (token: string) => {
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
    const server = app.getHttpServer();
    return {
      get: (p: string) => auth(request(server).get(p)),
      post: (p: string, body?: object) => auth(request(server).post(p)).send(body ?? {}),
      put: (p: string, body: unknown) => auth(request(server).put(p)).send(body as object),
      patch: (p: string, body: unknown) => auth(request(server).patch(p)).send(body as object),
    };
  };

  it('suggests, records decisions and downloads a Word resume, for the job owner only', async () => {
    const server = app.getHttpServer();
    await as('jane-token').put('/profile', PROFILE).expect(200);
    const job = await as('jane-token').post('/jobs', { description: DESCRIPTION }).expect(202);
    await app.get(JobsService).whenIdle();
    const base = `/jobs/${job.body.id}/resume-draft`;

    await request(server).get(base).expect(401);
    await as('bob-token').get(base).expect(404);
    await as('bob-token').post(base).expect(404);
    await as('jane-token').get('/jobs/not-a-uuid/resume-draft').expect(400);

    expect((await as('jane-token').get(base).expect(200)).body).toMatchObject({ status: 'none', aiEnabled: true });
    await as('jane-token').post(base).expect(202);
    await app.get(TailoringService).whenIdle();
    const draft = (await as('jane-token').get(base).expect(200)).body;
    expect(draft.status).toBe('ready');
    expect(draft.suggestions).toHaveLength(2);
    expect(draft.roles).toEqual([{ title: 'Engineer', company: 'Globex' }]);
    expect(draft.suggestions[1]).toMatchObject({ before: 'Built APIs', after: 'Built TypeScript APIs', decision: 'pending' });

    await as('jane-token').patch(base, { decisions: [{ id: draft.suggestions[0].id, decision: 'maybe' }] }).expect(400);
    await as('bob-token').patch(base, { decisions: [{ id: draft.suggestions[0].id, decision: 'accepted' }] }).expect(404);
    const decided = await as('jane-token')
      .patch(base, { decisions: [{ id: draft.suggestions[0].id, decision: 'accepted' }, { id: draft.suggestions[1].id, decision: 'rejected' }] })
      .expect(200);
    expect(decided.body.suggestions.map((s: { decision: string }) => s.decision)).toEqual(['accepted', 'rejected']);

    await as('bob-token').get(`${base}/document`).expect(404);
    const doc = await as('jane-token')
      .get(`${base}/document`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(doc.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(doc.headers['content-disposition']).toContain('filename="Jane Doe - Acme resume.docx"');
    expect((doc.body as Buffer).subarray(0, 2).toString()).toBe('PK'); // a .docx is a zip
    await as('jane-token').get(`${base}/document?layout=workday`).expect(200);
    await as('jane-token').get(`${base}/document?layout=fancy`).expect(400);
    const pdf = await as('jane-token').get(`${base}/document?format=pdf&layout=workday`).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('filename="Jane Doe - Acme resume.pdf"');
    await as('jane-token').get(`${base}/document?format=rtf`).expect(400);
    expect(Array.isArray(draft.checks)).toBe(true);
  });

  it("downloads the profile as a resume, in either layout, and lists what's missing", async () => {
    const server = app.getHttpServer();
    await request(server).get('/profile/document').expect(401);
    expect((await as('bob-token').get('/profile/resume-checks').expect(200)).body).toEqual([]);
    await as('bob-token').get('/profile/document').expect(409);

    const checks = (await as('jane-token').get('/profile/resume-checks').expect(200)).body;
    expect(checks).toContainEqual({ where: 'Personal details', message: 'Add a phone number: Workday asks for one.' });
    const doc = await as('jane-token').get('/profile/document?layout=workday').expect(200);
    expect(doc.headers['content-disposition']).toContain('filename="Jane Doe resume.docx"');
    await as('jane-token').get('/profile/document?layout=other').expect(400);
    const pdf = await as('jane-token').get('/profile/document?format=pdf').expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('filename="Jane Doe resume.pdf"');
  });

  it('scores the tailored resume against the original, side by side, and shows keyword coverage', async () => {
    const job = await as('jane-token').post('/jobs', { description: DESCRIPTION.replace('Acme', 'Acme Two') }).expect(202);
    await app.get(JobsService).whenIdle();
    const base = `/jobs/${job.body.id}/resume-draft`;
    await as('jane-token').post(`${base}/score`).expect(409); // no suggestions yet
    await as('jane-token').post(base).expect(202);
    await app.get(TailoringService).whenIdle();
    let draft = (await as('jane-token').get(base).expect(200)).body;
    expect(draft.score).toEqual({ status: 'none', result: null, error: null, scoredAt: null, outdated: false });
    // Before accepting anything, the keywords are the original's.
    expect(draft.keywords).toEqual({ total: 2, original: 1, tailored: 1, added: [], missing: ['PostgreSQL'] });
    await as('jane-token').post(`${base}/score`).expect(409); // nothing accepted

    const addSkill = draft.suggestions[0].id;
    draft = (await as('jane-token').patch(base, { decisions: [{ id: addSkill, decision: 'accepted' }] }).expect(200)).body;
    expect(draft.keywords).toEqual({ total: 2, original: 1, tailored: 2, added: ['PostgreSQL'], missing: [] });

    await as('bob-token').post(`${base}/score`).expect(404);
    expect((await as('jane-token').post(`${base}/score`).expect(202)).body.score.status).toBe('scoring');
    await app.get(TailoringService).whenIdle();
    draft = (await as('jane-token').get(base).expect(200)).body;
    expect(draft.score).toMatchObject({
      status: 'ready',
      outdated: false,
      result: { original: { score: 70, verdict: 'good', summary: 'Good.' }, tailored: { score: 82, summary: 'Covers the stack.' } },
    });
    expect(draft.score.scoredAt).not.toBeNull();

    // Changing the accepted changes makes the score out of date (it stays visible).
    draft = (await as('jane-token').patch(base, { decisions: [{ id: addSkill, decision: 'rejected' }] }).expect(200)).body;
    expect(draft.score).toMatchObject({ status: 'ready', outdated: true });

    // New suggestions start without a score.
    await as('jane-token').post(base).expect(202);
    await app.get(TailoringService).whenIdle();
    expect((await as('jane-token').get(base).expect(200)).body.score.status).toBe('none');
  });

  it('asks about gaps: "yes" adds the experience to the resume, for the job owner only', async () => {
    const job = await as('jane-token').post('/jobs', { description: DESCRIPTION.replace('Acme', 'Acme Three') }).expect(202);
    await app.get(JobsService).whenIdle();
    const base = `/jobs/${job.body.id}/resume-draft`;
    await as('jane-token').put(`${base}/gaps/x`, { answer: 'no' }).expect(409); // no suggestions yet
    await as('jane-token').post(base).expect(202);
    await app.get(TailoringService).whenIdle();
    const draft = (await as('jane-token').get(base).expect(200)).body;
    expect(draft.gaps).toEqual([expect.objectContaining({ text: 'Kubernetes not shown in your profile', answer: 'pending' })]);
    const gap = `${base}/gaps/${draft.gaps[0].id}`;

    await as('bob-token').put(gap, { answer: 'no' }).expect(404);
    await as('jane-token').put(gap, { answer: 'yes', experience: 'short', workIndex: 0 }).expect(400);
    await as('jane-token').put(`${base}/gaps/not%20an%20id!`, { answer: 'no' }).expect(400);
    const yes = (await as('jane-token').put(gap, { answer: 'yes', experience: 'Ran our Kubernetes clusters at Globex.', workIndex: 0 }).expect(200)).body;
    expect(yes.gaps[0]).toMatchObject({ answer: 'yes', workIndex: 0 });
    expect(yes.suggestions.filter((s: { gapId?: string }) => s.gapId).map((s: { after: string; decision: string }) => [s.after, s.decision])).toEqual([
      ['Ran Kubernetes clusters', 'accepted'],
      ['Kubernetes', 'accepted'],
    ]);
    // A gap's changes count as accepted, so the resume can be generated (scored).
    await as('jane-token').post(`${base}/score`).expect(202);
    await app.get(TailoringService).whenIdle();

    const no = (await as('jane-token').put(gap, { answer: 'no' }).expect(200)).body;
    expect(no.gaps[0].answer).toBe('no');
    expect(no.suggestions.some((s: { gapId?: string }) => s.gapId)).toBe(false);
    expect(no.score.outdated).toBe(true);
  });
});
