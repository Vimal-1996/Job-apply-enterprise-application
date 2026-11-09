import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TOKEN_VERIFIER } from '../src/auth/auth.types';
import { USER_DIRECTORY } from '../src/admin/users/user.types';
import { PG_POOL } from '../src/db/database.module';
import { PgUserStore } from '../src/db/user-store';
import { PROFILE_EXTRACTOR, ProfileExtractor } from '../src/profile/profile-extractor';
import { CandidateProfile } from '../src/profile/profile.schema';
import { ProfileService } from '../src/profile/profile.service';
import { RESUME_FILES, ResumeFiles } from '../src/resumes/resume-files';
import { detail, fakeDirectory, fakeVerifier } from './fakes';

const PDF = 'application/pdf';
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

describe('profile (e2e)', () => {
  let app: INestApplication;
  const objects = new Map<string, Buffer>();
  const files: ResumeFiles = {
    presignUpload: async (key, contentType) => ({ url: 'https://s3.example/b', fields: { key, 'Content-Type': contentType }, expiresInSeconds: 300 }),
    head: async (key) => (objects.has(key) ? { size: objects.get(key)!.length } : null),
    readStart: async (key, n) => objects.get(key)!.subarray(0, n),
    read: async (key) => objects.get(key)!,
    markReady: async () => undefined,
    presignDownload: async (key) => `https://s3.example/${key}?signed`,
    delete: async (key) => void objects.delete(key),
    deleteAllForUser: async () => undefined,
  };
  const read: string[] = [];
  const extractor: ProfileExtractor = {
    extract: async (file) => {
      read.push(file.fileName);
      return PROFILE;
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(fakeVerifier(TOKENS))
      .overrideProvider(USER_DIRECTORY)
      .useValue(fakeDirectory([detail('u-jane'), detail('u-bob')]))
      .overrideProvider(RESUME_FILES)
      .useValue(files)
      .overrideProvider(PROFILE_EXTRACTOR)
      .useValue(extractor)
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
    };
  };

  it('requires sign-in', async () => {
    const server = app.getHttpServer();
    await request(server).get('/profile').expect(401);
    await request(server).put('/profile').send(PROFILE).expect(401);
    await request(server).post('/profile/parse').expect(401);
    await request(server).get('/preferences').expect(401);
  });

  it('reads an uploaded resume into the profile, visible only to its owner', async () => {
    expect((await as('jane-token').get('/profile').expect(200)).body).toMatchObject({ status: 'none', aiEnabled: true });
    await as('jane-token').post('/profile/parse').expect(409); // no resume yet

    const up = await as('jane-token').post('/resumes/uploads', { fileName: 'Jane CV.pdf', contentType: PDF, sizeBytes: 14 }).expect(201);
    objects.set(up.body.upload.fields.key, Buffer.from('%PDF-1.7 hello'));
    await as('jane-token').post(`/resumes/${up.body.resume.id}/complete`).expect(200);
    await app.get(ProfileService).whenIdle('u-jane');

    expect((await as('jane-token').get('/profile').expect(200)).body).toMatchObject({ status: 'ready', profile: PROFILE, sourceFileName: 'Jane CV.pdf' });
    expect(read).toEqual(['Jane CV.pdf']);
    expect((await as('bob-token').get('/profile').expect(200)).body.status).toBe('none');

    expect((await as('jane-token').post('/profile/parse').expect(202)).body.status).toBe('parsing');
    await app.get(ProfileService).whenIdle('u-jane');
    expect(read).toHaveLength(2);
  });

  it('saves valid edits and rejects invalid ones', async () => {
    const edited = { ...PROFILE, skills: ['TypeScript', 'AWS'] };
    expect((await as('jane-token').put('/profile', edited).expect(200)).body.profile.skills).toEqual(['TypeScript', 'AWS']);
    const bad = await as('jane-token').put('/profile', { ...PROFILE, yearsExperience: 'six' }).expect(400);
    expect(bad.body.message).toContain('yearsExperience');
  });

  it('saves preferences per user', async () => {
    const prefs = {
      targetTitles: ['Backend Engineer'],
      locations: ['Toronto'],
      workModes: ['remote'],
      minSalary: null,
      needsSponsorship: false,
      excludedCompanies: [],
    };
    expect((await as('jane-token').put('/preferences', prefs).expect(200)).body).toEqual(prefs);
    expect((await as('jane-token').get('/preferences').expect(200)).body).toEqual(prefs);
    expect((await as('bob-token').get('/preferences').expect(200)).body.targetTitles).toEqual([]);
    await as('jane-token').put('/preferences', { ...prefs, workModes: ['moon'] }).expect(400);
  });
});
