import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TOKEN_VERIFIER } from '../src/auth/auth.types';
import { USER_DIRECTORY } from '../src/admin/users/user.types';
import { RESUME_FILES, ResumeFiles } from '../src/resumes/resume-files';
import { PG_POOL } from '../src/db/database.module';
import { PgUserStore } from '../src/db/user-store';
import { detail, fakeDirectory, fakeVerifier } from './fakes';

const PDF = 'application/pdf';
const TOKENS = {
  'jane-token': { sub: 'u-jane', client_id: 'c', 'cognito:groups': ['user'] },
  'bob-token': { sub: 'u-bob', client_id: 'c', 'cognito:groups': ['user'] },
  'gone-token': { sub: 'u-gone', client_id: 'c', 'cognito:groups': ['user'] },
};

describe('resumes (e2e)', () => {
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
  const directory = fakeDirectory([detail('u-jane'), detail('u-bob'), detail('u-gone', { accountStatus: 'deleted' })]);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(fakeVerifier(TOKENS))
      .overrideProvider(USER_DIRECTORY)
      .useValue(directory)
      .overrideProvider(RESUME_FILES)
      .useValue(files)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    // The real directory adds users to the table on first sight; here, seed them.
    const users = new PgUserStore(app.get(PG_POOL));
    for (const id of ['u-jane', 'u-bob', 'u-gone']) await users.upsert({ id, email: `${id}@example.com`, role: 'user', accountStatus: 'active' });
  });

  afterAll(() => app.close());

  const as = (token: string) => {
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
    const server = app.getHttpServer();
    return {
      get: (p: string) => auth(request(server).get(p)),
      post: (p: string, body?: object) => auth(request(server).post(p)).send(body ?? {}),
      del: (p: string) => auth(request(server).delete(p)),
    };
  };

  /** What the browser does: request, upload to "S3", complete. */
  async function uploadAs(token: string, fileName: string, body: Buffer) {
    const res = await as(token).post('/resumes/uploads', { fileName, contentType: PDF, sizeBytes: body.length }).expect(201);
    objects.set(res.body.upload.fields.key, body);
    return as(token).post(`/resumes/${res.body.resume.id}/complete`);
  }

  it('requires sign-in', async () => {
    await request(app.getHttpServer()).get('/resumes').expect(401);
    await request(app.getHttpServer()).post('/resumes/uploads').send({}).expect(401);
  });

  it('refuses a deleted account (the existing account check covers resumes too)', async () => {
    expect((await as('gone-token').get('/resumes').expect(403)).body.code).toBe('ACCOUNT_DELETED');
  });

  it('uploads, lists, downloads, and never exposes the storage key', async () => {
    const done = await uploadAs('jane-token', 'Jane CV.pdf', Buffer.from('%PDF-1.7 hello'));
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ fileName: 'Jane CV.pdf', isCurrent: true, contentType: PDF });
    expect(JSON.stringify(done.body)).not.toContain('users/');

    const list = await as('jane-token').get('/resumes').expect(200);
    expect(list.body.map((r: { id: string }) => r.id)).toEqual([done.body.id]);

    const dl = await as('jane-token').get(`/resumes/${done.body.id}/download`).expect(200);
    expect(dl.body).toEqual({ url: `https://s3.example/users/u-jane/${done.body.id}?signed`, expiresInSeconds: 60 });
  });

  it('puts each upload under the caller, whatever the request says', async () => {
    const res = await as('bob-token').post('/resumes/uploads', { fileName: 'cv.pdf', contentType: PDF, sizeBytes: 10, userId: 'u-jane', key: 'users/u-jane/x' }).expect(201);
    expect(res.body.upload.fields.key).toMatch(/^users\/u-bob\//);
  });

  it("can't reach another user's resume", async () => {
    const [jane] = (await as('jane-token').get('/resumes').expect(200)).body;
    await as('bob-token').get(`/resumes/${jane.id}/download`).expect(404);
    await as('bob-token').post(`/resumes/${jane.id}/current`).expect(404);
    await as('bob-token').del(`/resumes/${jane.id}`).expect(404);
    expect((await as('bob-token').get('/resumes').expect(200)).body).toEqual([]);
  });

  it('validates the request and the stored file', async () => {
    await as('bob-token').post('/resumes/uploads', { fileName: 'cv.png', contentType: 'image/png', sizeBytes: 10 }).expect(400);
    await as('bob-token').post('/resumes/uploads', { fileName: 'cv.pdf', contentType: PDF, sizeBytes: 6 * 1024 * 1024 }).expect(400);
    const fake = await uploadAs('bob-token', 'cv.pdf', Buffer.from('MZ not a pdf'));
    expect(fake.status).toBe(422);
    await as('bob-token').get('/resumes/not-a-uuid/download').expect(400);
  });

  it('deletes', async () => {
    const up = await uploadAs('bob-token', 'cv.pdf', Buffer.from('%PDF-1.4'));
    expect(up.status).toBe(200);
    const r = up.body;
    await as('bob-token').del(`/resumes/${r.id}`).expect(204);
    expect((await as('bob-token').get('/resumes').expect(200)).body).toEqual([]);
  });
});
