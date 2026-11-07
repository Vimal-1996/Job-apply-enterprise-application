import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TOKEN_VERIFIER } from '../src/auth/auth.types';
import { USER_DIRECTORY } from '../src/admin/users/user.types';
import { WindowCounter } from '../src/signup/rate-limiter';
import { SIGNUP_ACCEPTED, SIGNUP_LIMITS } from '../src/signup/signup.controller';
import { detail, fakeDirectory, fakeVerifier } from './fakes';

describe('signup (e2e)', () => {
  let app: INestApplication;
  const directory = fakeDirectory([
    detail('u-existing', { email: 'taken@example.com' }),
    detail('u-gone', { email: 'gone@example.com', accountStatus: 'deleted' }),
    detail('u-pending', { email: 'pending@example.com', status: 'FORCE_CHANGE_PASSWORD' }),
    detail('u-off', { email: 'off@example.com', status: 'FORCE_CHANGE_PASSWORD', accountStatus: 'inactive' }),
  ]);
  const limits = { perIp: new WindowCounter(3, 60_000), global: new WindowCounter(1000, 60_000) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(fakeVerifier({}))
      .overrideProvider(USER_DIRECTORY)
      .useValue(directory)
      .overrideProvider(SIGNUP_LIMITS)
      .useValue(limits)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => {
    directory.reset();
    jest.clearAllMocks();
    // fresh limits per test
    limits.perIp = new WindowCounter(3, 60_000);
    limits.global = new WindowCounter(1000, 60_000);
  });

  const signup = (body: object) => request(app.getHttpServer()).post('/signup').send(body);

  it('is public and creates an invited user (normalised email)', async () => {
    const res = await signup({ email: ' New@Example.com ' }).expect(202);
    expect(res.body).toEqual(SIGNUP_ACCEPTED);
    expect(directory.createUser).toHaveBeenCalledWith('new@example.com');
  });

  it('gives the same answer for an existing, deleted or deactivated account, and sends nothing', async () => {
    for (const email of ['taken@example.com', 'gone@example.com', 'off@example.com']) {
      expect((await signup({ email }).expect(202)).body).toEqual(SIGNUP_ACCEPTED);
    }
    expect(directory.resendInvite).not.toHaveBeenCalled();
    expect(directory.setStatus).not.toHaveBeenCalled();
  });

  it('sends a fresh temporary password to someone who never finished signing up', async () => {
    expect((await signup({ email: 'pending@example.com' }).expect(202)).body).toEqual(SIGNUP_ACCEPTED);
    expect(directory.resendInvite).toHaveBeenCalledWith('u-pending');
    expect(directory.createUser).toHaveBeenCalledTimes(1); // tried, found existing
  });

  it('validates the email (400) without creating anything', async () => {
    await signup({}).expect(400);
    await signup({ email: 'nope' }).expect(400);
    expect(directory.createUser).not.toHaveBeenCalled();
  });

  it('rate limits per client (429)', async () => {
    for (let i = 0; i < 3; i++) await signup({ email: `p${i}@example.com` }).expect(202);
    const res = await signup({ email: 'p3@example.com' }).expect(429);
    expect(res.body.message).toMatch(/try again later/);
    expect(directory.createUser).toHaveBeenCalledTimes(3);
  });

  it('enforces the global daily cap (429)', async () => {
    limits.global = new WindowCounter(1, 60_000);
    await signup({ email: 'first@example.com' }).expect(202);
    await signup({ email: 'second@example.com' }).expect(429);
  });

  it('returns 500 (not a fake success) if Cognito fails', async () => {
    directory.createUser.mockRejectedValueOnce(new Error('cognito down'));
    await signup({ email: 'x@example.com' }).expect(500);
  });
});
