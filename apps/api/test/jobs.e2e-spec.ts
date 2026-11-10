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
import { detail, fakeDirectory, fakeVerifier } from './fakes';

const TOKENS = {
  'jane-token': { sub: 'u-jane', client_id: 'c', 'cognito:groups': ['user'] },
  'bob-token': { sub: 'u-bob', client_id: 'c', 'cognito:groups': ['user'] },
};

const PROFILE: CandidateProfile = {
  fullName: 'Jane Doe',
  headline: 'Backend Engineer',
  email: null,
  phone: null,
  location: 'Toronto, ON',
  links: [],
  summary: null,
  yearsExperience: 6,
  skills: ['TypeScript'],
  workHistory: [],
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
    location: 'Toronto',
    workMode: null,
    employmentType: null,
    seniority: null,
    salary: null,
    yearsRequired: null,
    requiredSkills: ['TypeScript'],
    niceToHaveSkills: [],
    overview: 'Builds backend APIs.',
    responsibilities: ['Build APIs'],
    benefits: [],
    visaSponsorship: 'not_stated',
    applyUrl: null,
  },
  match: { score: 74, verdict: 'good', summary: 'A good fit.', strengths: [], gaps: [], dealbreakers: [] },
};

const DESCRIPTION = 'Acme is hiring a Backend Engineer to build TypeScript services in Toronto. '.repeat(4);

describe('jobs (e2e)', () => {
  let app: INestApplication;
  const matcher: JobMatcher = { analyse: async () => ANALYSIS };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(fakeVerifier(TOKENS))
      .overrideProvider(USER_DIRECTORY)
      .useValue(fakeDirectory([detail('u-jane'), detail('u-bob')]))
      .overrideProvider(JOB_MATCHER)
      .useValue(matcher)
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
      delete: (p: string) => auth(request(server).delete(p)),
    };
  };

  it('requires sign-in', async () => {
    const server = app.getHttpServer();
    await request(server).get('/jobs').expect(401);
    await request(server).post('/jobs').send({ description: DESCRIPTION }).expect(401);
  });

  it('needs a profile before adding a job', async () => {
    const res = await as('jane-token').post('/jobs', { description: DESCRIPTION }).expect(409);
    expect(res.body.message).toMatch(/Set up your profile/);
  });

  it('adds, matches, lists, re-matches and deletes a job, for its owner only', async () => {
    await as('jane-token').put('/profile', PROFILE).expect(200);

    const added = await as('jane-token').post('/jobs', { link: 'https://www.linkedin.com/jobs/view/4012345678/?trk=x', description: DESCRIPTION }).expect(202);
    expect(added.body).toMatchObject({ source: 'linkedin', url: 'https://www.linkedin.com/jobs/view/4012345678/', matchStatus: 'matching' });
    await app.get(JobsService).whenIdle();

    const id = added.body.id;
    expect((await as('jane-token').get(`/jobs/${id}`).expect(200)).body).toMatchObject({ matchStatus: 'ready', score: 74, title: 'Backend Engineer' });
    expect((await as('jane-token').get('/jobs').expect(200)).body).toHaveLength(1);

    const dup = await as('jane-token').post('/jobs', { link: '4012345678', description: DESCRIPTION }).expect(409);
    expect(dup.body).toMatchObject({ message: "You've already added this job", jobId: id });

    expect((await as('bob-token').get('/jobs').expect(200)).body).toEqual([]);
    await as('bob-token').get(`/jobs/${id}`).expect(404);
    await as('bob-token').post(`/jobs/${id}/match`).expect(404);
    await as('bob-token').delete(`/jobs/${id}`).expect(404);

    expect((await as('jane-token').post(`/jobs/${id}/match`).expect(202)).body.matchStatus).toBe('matching');
    await app.get(JobsService).whenIdle();

    const tracked = await as('jane-token').patch(`/jobs/${id}/application`, { status: 'applied', notes: 'Applied on the company site' }).expect(200);
    expect(tracked.body).toMatchObject({ applicationStatus: 'applied', notes: 'Applied on the company site' });
    expect(tracked.body.timeline.map((t: { status: string }) => t.status)).toEqual(['saved', 'applied']);
    await as('jane-token').patch(`/jobs/${id}/application`, { status: 'hired' }).expect(400);
    await as('bob-token').patch(`/jobs/${id}/application`, { status: 'offer' }).expect(404);

    await as('jane-token').delete(`/jobs/${id}`).expect(204);
    await as('jane-token').get(`/jobs/${id}`).expect(404);
  });

  it('rejects bad input with a useful message', async () => {
    expect((await as('jane-token').post('/jobs', { description: 'short' }).expect(400)).body.message).toMatch(/too short/);
    expect((await as('jane-token').post('/jobs', { link: 'https://www.indeed.com/', description: DESCRIPTION }).expect(400)).body.message).toMatch(
      /doesn't point to a job/,
    );
    await as('jane-token').get('/jobs/not-an-id').expect(400);
  });
});
