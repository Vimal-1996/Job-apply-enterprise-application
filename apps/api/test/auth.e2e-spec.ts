import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TOKEN_VERIFIER } from '../src/auth/auth.types';
import { USER_DIRECTORY } from '../src/admin/users/user.types';
import { detail, fakeDirectory, fakeVerifier } from './fakes';

const TOKENS = {
  'admin-token': { sub: 'u-admin', client_id: 'c', 'cognito:groups': ['admin'] },
  'user-token': { sub: 'u-user', client_id: 'c', 'cognito:groups': ['user'] },
  'nogroup-token': { sub: 'u-none', client_id: 'c' },
  'nomfa-admin-token': { sub: 'u-admin-nomfa', client_id: 'c', 'cognito:groups': ['admin'] },
  // Status changed after the token was issued: only the live lookup knows.
  'inactive-token': { sub: 'u-inactive', client_id: 'c', 'cognito:groups': ['user'] },
  'deleted-token': { sub: 'u-deleted', client_id: 'c', 'cognito:groups': ['user'] },
  'gone-token': { sub: 'u-gone', client_id: 'c', 'cognito:groups': ['user'] },
  // Status already in the token's groups.
  'inactive-claim-token': { sub: 'u-user', client_id: 'c', 'cognito:groups': ['user', 'inactive'] },
};

describe('auth (e2e)', () => {
  let app: INestApplication;
  const directory = fakeDirectory([
    detail('u-admin', { groups: ['admin'], mfaMethods: ['SOFTWARE_TOKEN_MFA'] }),
    detail('u-admin-nomfa', { groups: ['admin'] }),
    detail('u-user'),
    detail('u-none', { groups: [] }),
    detail('u-inactive', { accountStatus: 'inactive' }),
    detail('u-deleted', { accountStatus: 'deleted' }),
  ]);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(fakeVerifier(TOKENS))
      .overrideProvider(USER_DIRECTORY)
      .useValue(directory)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  const me = (token: string) => request(app.getHttpServer()).get('/me').set('Authorization', `Bearer ${token}`);

  it('GET /health is public', () => request(app.getHttpServer()).get('/health').expect(200));

  it('rejects requests with no token (401)', () => request(app.getHttpServer()).get('/me').expect(401));

  it('rejects an invalid token (401)', () => me('nope').expect(401));

  it('rejects a non-bearer scheme (401)', () =>
    request(app.getHttpServer()).get('/me').set('Authorization', 'Basic abc').expect(401));

  it('returns the caller on GET /me', async () => {
    const res = await me('user-token').expect(200);
    expect(res.body).toEqual({ id: 'u-user', groups: ['user'] });
  });

  it('blocks an inactive account with a contact-admin message (403)', async () => {
    const res = await me('inactive-token').expect(403);
    expect(res.body).toEqual({
      statusCode: 403,
      code: 'ACCOUNT_INACTIVE',
      message: 'Your account has been deactivated. Please contact your administrator.',
    });
  });

  it('blocks a deleted account with a contact-admin message (403)', async () => {
    const res = await me('deleted-token').expect(403);
    expect(res.body.code).toBe('ACCOUNT_DELETED');
    expect(res.body.message).toMatch(/contact your administrator/);
  });

  it('treats a user removed from the pool as deleted', async () => {
    expect((await me('gone-token').expect(403)).body.code).toBe('ACCOUNT_DELETED');
  });

  it('blocks on status groups in the token without a lookup', async () => {
    directory.statusOf.mockClear();
    expect((await me('inactive-claim-token').expect(403)).body.code).toBe('ACCOUNT_INACTIVE');
    expect(directory.statusOf).not.toHaveBeenCalled();
  });

  it('fails closed when the status lookup fails (503)', async () => {
    directory.statusOf.mockRejectedValueOnce(new Error('aws down'));
    await me('nogroup-token').expect(503);
  });

  it('forbids a normal user from /admin/ping (403)', () =>
    request(app.getHttpServer()).get('/admin/ping').set('Authorization', 'Bearer user-token').expect(403));

  it('forbids a user with no groups from /admin/ping (403)', () =>
    request(app.getHttpServer()).get('/admin/ping').set('Authorization', 'Bearer nogroup-token').expect(403));

  it('allows an admin on /admin/ping (200)', () =>
    request(app.getHttpServer()).get('/admin/ping').set('Authorization', 'Bearer admin-token').expect(200));

  it('refuses admin routes to an admin without MFA, but not normal routes', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/ping')
      .set('Authorization', 'Bearer nomfa-admin-token')
      .expect(403);
    expect(res.body.code).toBe('MFA_REQUIRED');
    await me('nomfa-admin-token').expect(200);
  });

  it('never asks a normal user for MFA', async () => {
    directory.mfaEnabled.mockClear();
    await me('user-token').expect(200);
    expect(directory.mfaEnabled).not.toHaveBeenCalled();
  });

  it('requires authentication before authorization on /admin/ping (401, not 403)', () =>
    request(app.getHttpServer()).get('/admin/ping').expect(401));
});
