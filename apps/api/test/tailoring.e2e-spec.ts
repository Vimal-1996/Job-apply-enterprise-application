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
  match: { score: 70, verdict: 'good', summary: 'Good.', strengths: [], gaps: [], dealbreakers: [] },
};

const DESCRIPTION = 'Acme is hiring a Backend Engineer to build TypeScript and PostgreSQL services. '.repeat(4);

describe('resume tailoring (e2e)', () => {
  let app: INestApplication;
  const matcher: JobMatcher = { analyse: async () => ANALYSIS };
  const tailor: ResumeTailor = {
    suggest: async () => [
      { kind: 'add_skill', workIndex: null, bulletIndex: null, after: 'PostgreSQL', reason: 'The posting requires it.', source: 'resume', question: null },
      { kind: 'rewrite_bullet', workIndex: 0, bulletIndex: 0, after: 'Built TypeScript APIs', reason: 'Names the stack.', source: 'resume', question: null },
    ],
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
  });
});
