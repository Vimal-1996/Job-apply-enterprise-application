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
};

describe('admin users (e2e)', () => {
  let app: INestApplication;
  const directory = fakeDirectory([
    detail('u-admin', { groups: ['admin'], mfaMethods: ['SOFTWARE_TOKEN_MFA'] }),
    detail('u-admin2', { groups: ['admin', 'user'], mfaMethods: ['SOFTWARE_TOKEN_MFA'] }),
    detail('u-user'),
    detail('u-other'),
    detail('u-deleted', { accountStatus: 'deleted' }),
    detail('u-invited', { status: 'FORCE_CHANGE_PASSWORD' }),
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
  beforeEach(() => {
    directory.reset();
    jest.clearAllMocks();
  });

  const call = (method: 'get' | 'post' | 'delete', path: string, token?: string, body?: object) => {
    let r = request(app.getHttpServer())[method](path);
    if (token) r = r.set('Authorization', `Bearer ${token}`);
    return body ? r.send(body) : r;
  };
  const get = (path: string, token?: string) => call('get', path, token);

  it('401 without a token', () => get('/admin/users').expect(401));

  it('403 for a normal user, and the directory is never queried', async () => {
    await get('/admin/users', 'user-token').expect(403);
    await get('/admin/users/u-user', 'user-token').expect(403);
    await call('post', '/admin/users/u-other/deactivate', 'user-token').expect(403);
    await call('delete', '/admin/users/u-other', 'user-token').expect(403);
    expect(directory.listUsers).not.toHaveBeenCalled();
    expect(directory.getUser).not.toHaveBeenCalled();
    expect(directory.setStatus).not.toHaveBeenCalled();
  });

  it('lists users for an admin', async () => {
    const res = await get('/admin/users?filter=user', 'admin-token').expect(200);
    expect(res.body.users.map((u: { id: string }) => u.id)).toContain('u-user');
    expect(directory.listUsers).toHaveBeenCalledWith({ filter: 'user', nextToken: undefined });
  });

  it('rejects an unknown filter (400)', () => get('/admin/users?filter=everyone', 'admin-token').expect(400));

  it('rejects a malformed user id (400)', () => get('/admin/users/bad%20id%3B', 'admin-token').expect(400));

  it('returns one user, or 404', async () => {
    const res = await get('/admin/users/u-user', 'admin-token').expect(200);
    expect(res.body.identityProvider).toBe('Cognito');
    await get('/admin/users/missing', 'admin-token').expect(404);
  });

  describe('deactivate / reactivate / delete', () => {
    it('deactivates a user, who is then blocked immediately', async () => {
      await get('/me', 'user-token').expect(200); // warms the status cache
      const res = await call('post', '/admin/users/u-user/deactivate', 'admin-token').expect(200);
      expect(res.body.accountStatus).toBe('inactive');
      expect(directory.setStatus).toHaveBeenCalledWith('u-user', 'inactive');
      expect((await get('/me', 'user-token').expect(403)).body.code).toBe('ACCOUNT_INACTIVE');
    });

    it('reactivates an inactive user', async () => {
      await call('post', '/admin/users/u-user/deactivate', 'admin-token').expect(200);
      const res = await call('post', '/admin/users/u-user/reactivate', 'admin-token').expect(200);
      expect(res.body.accountStatus).toBe('active');
      await get('/me', 'user-token').expect(200);
    });

    it('deletes (soft) a user, who is then told their account was deleted', async () => {
      const res = await call('delete', '/admin/users/u-user', 'admin-token').expect(200);
      expect(res.body.accountStatus).toBe('deleted');
      expect(directory.setStatus).toHaveBeenCalledWith('u-user', 'deleted');
      expect((await get('/me', 'user-token').expect(403)).body.code).toBe('ACCOUNT_DELETED');
    });

    it('can delete an inactive user', async () => {
      await call('post', '/admin/users/u-other/deactivate', 'admin-token').expect(200);
      await call('delete', '/admin/users/u-other', 'admin-token').expect(200);
    });

    it('refuses to touch an admin, including yourself (403)', async () => {
      await call('post', '/admin/users/u-admin2/deactivate', 'admin-token').expect(403);
      await call('delete', '/admin/users/u-admin2', 'admin-token').expect(403);
      await call('delete', '/admin/users/u-admin', 'admin-token').expect(403);
      expect(directory.setStatus).not.toHaveBeenCalled();
    });

    it('keeps a deleted user deleted (409), and a repeat delete is a no-op', async () => {
      await call('post', '/admin/users/u-deleted/deactivate', 'admin-token').expect(409);
      await call('delete', '/admin/users/u-deleted', 'admin-token').expect(200);
      expect(directory.setStatus).not.toHaveBeenCalled();
    });

    it('does not reactivate a deleted user (409) or an active one (no-op)', async () => {
      await call('post', '/admin/users/u-deleted/reactivate', 'admin-token').expect(409);
      await call('post', '/admin/users/u-other/reactivate', 'admin-token').expect(200);
      expect(directory.setStatus).not.toHaveBeenCalled();
    });

    it('404 for an unknown user, 400 for a malformed id', async () => {
      await call('post', '/admin/users/missing/deactivate', 'admin-token').expect(404);
      await call('delete', '/admin/users/bad%20id', 'admin-token').expect(400);
    });
  });

  describe('add user / resend invitation', () => {
    const add = (body: object, token = 'admin-token') => call('post', '/admin/users', token, body);

    it('creates a user (normalised email) and returns them as invited', async () => {
      const res = await add({ email: '  New.Person@Example.com ' }).expect(201);
      expect(directory.createUser).toHaveBeenCalledWith('new.person@example.com');
      expect(res.body).toMatchObject({ email: 'new.person@example.com', status: 'FORCE_CHANGE_PASSWORD', groups: ['user'] });
    });

    it('is admin-only, and validates the email', async () => {
      await add({ email: 'x@example.com' }, 'user-token').expect(403);
      await add({}).expect(400);
      await add({ email: 42 }).expect(400);
      await add({ email: 'not-an-email' }).expect(400);
      await add({ email: 'a b@example.com' }).expect(400);
      expect(directory.createUser).not.toHaveBeenCalled();
    });

    it('409 when the email already has an account (including a deleted one)', async () => {
      await add({ email: 'u-user@example.com' }).expect(409);
      await add({ email: 'u-deleted@example.com' }).expect(409);
    });

    it('resends the invitation to someone who has not signed in yet', async () => {
      await call('post', '/admin/users/u-invited/resend-invite', 'admin-token').expect(200);
      expect(directory.resendInvite).toHaveBeenCalledWith('u-invited');
    });

    it('refuses to resend for a user who has signed in, or is not active (409)', async () => {
      await call('post', '/admin/users/u-user/resend-invite', 'admin-token').expect(409);
      await call('post', '/admin/users/u-deleted/resend-invite', 'admin-token').expect(409);
      await call('post', '/admin/users/u-invited/resend-invite', 'user-token').expect(403);
      expect(directory.resendInvite).not.toHaveBeenCalled();
    });
  });
});
