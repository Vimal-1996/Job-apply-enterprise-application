import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TOKEN_VERIFIER } from '../src/auth/auth.types';
import { USER_DIRECTORY, UserDirectory } from '../src/admin/users/user.types';

const TOKENS: Record<string, { sub: string; client_id: string; 'cognito:groups'?: string[] }> = {
  'admin-token': { sub: 'u-admin', client_id: 'c', 'cognito:groups': ['admin'] },
  'user-token': { sub: 'u-user', client_id: 'c', 'cognito:groups': ['user'] },
};

const summary = {
  id: 'u-user',
  email: 'user@example.com',
  emailVerified: true,
  status: 'CONFIRMED',
  enabled: true,
  groups: ['user' as const],
  createdAt: null,
  updatedAt: null,
};

describe('admin users (e2e)', () => {
  let app: INestApplication;
  const directory = {
    listUsers: jest.fn<ReturnType<UserDirectory['listUsers']>, Parameters<UserDirectory['listUsers']>>(async () => ({
      users: [summary],
      nextToken: null,
    })),
    getUser: jest.fn<ReturnType<UserDirectory['getUser']>, Parameters<UserDirectory['getUser']>>(async (id) =>
      id === 'u-user' ? { ...summary, mfaMethods: [], preferredMfa: null, identityProvider: 'Cognito' } : null,
    ),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue({
        verify: async (t: string) => {
          if (!TOKENS[t]) throw new Error('bad token');
          return TOKENS[t];
        },
      })
      .overrideProvider(USER_DIRECTORY)
      .useValue(directory)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  const get = (path: string, token?: string) => {
    const r = request(app.getHttpServer()).get(path);
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };

  it('401 without a token', () => get('/admin/users').expect(401));

  it('403 for a normal user, and the directory is never queried', async () => {
    await get('/admin/users', 'user-token').expect(403);
    await get('/admin/users/u-user', 'user-token').expect(403);
    expect(directory.listUsers).not.toHaveBeenCalled();
    expect(directory.getUser).not.toHaveBeenCalled();
  });

  it('lists users for an admin', async () => {
    const res = await get('/admin/users?filter=user', 'admin-token').expect(200);
    expect(res.body).toEqual({ users: [summary], nextToken: null });
    expect(directory.listUsers).toHaveBeenCalledWith({ filter: 'user', nextToken: undefined });
  });

  it('rejects an unknown filter (400)', () => get('/admin/users?filter=everyone', 'admin-token').expect(400));

  it('rejects a malformed user id (400)', () => get('/admin/users/bad%20id%3B', 'admin-token').expect(400));

  it('returns one user, or 404', async () => {
    const res = await get('/admin/users/u-user', 'admin-token').expect(200);
    expect(res.body.identityProvider).toBe('Cognito');
    await get('/admin/users/missing', 'admin-token').expect(404);
  });
});
