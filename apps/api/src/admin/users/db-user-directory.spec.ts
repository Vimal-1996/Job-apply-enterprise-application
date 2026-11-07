import { migrate } from '../../db/migrate';
import { closeTestPools, testPool } from '../../db/test-pool';
import { PgUserStore } from '../../db/user-store';
import { DbUserDirectory } from './db-user-directory';
import { UserDetail, UserExistsError } from './user.types';

const live = (id: string, over: Partial<UserDetail> = {}): UserDetail => ({
  id,
  email: `${id}@example.com`,
  emailVerified: true,
  status: 'CONFIRMED',
  enabled: true,
  accountStatus: 'active',
  groups: ['user'],
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-02T00:00:00.000Z',
  mfaMethods: [],
  preferredMfa: null,
  identityProvider: 'Cognito',
  ...over,
});

/** Fake Cognito side holding users by id. */
function fakeCognito(users: UserDetail[] = []) {
  const pool = new Map(users.map((u) => [u.id, u]));
  let n = 0;
  return {
    pool,
    getUser: jest.fn(async (idOrEmail: string) => pool.get(idOrEmail) ?? [...pool.values()].find((u) => u.email === idOrEmail) ?? null),
    createUser: jest.fn(async (email: string) => {
      if ([...pool.values()].some((u) => u.email === email)) throw new UserExistsError();
      const u = live(`new-${++n}`, { email, status: 'FORCE_CHANGE_PASSWORD' });
      pool.set(u.id, u);
      return u;
    }),
    resendInvite: jest.fn(async () => undefined),
    purgeUser: jest.fn(async (id: string) => void pool.delete(id)),
    mfaEnabled: jest.fn(async () => true),
    revokeSessions: jest.fn(async () => undefined),
  };
}

async function setup(cognitoUsers: UserDetail[] = []) {
  const db = await testPool();
  await migrate(db);
  const store = new PgUserStore(db);
  const cognito = fakeCognito(cognitoUsers);
  return { store, cognito, dir: new DbUserDirectory(store, cognito) };
}

afterAll(closeTestPools);

describe('DbUserDirectory', () => {
  it('creates a user in Cognito and the table, listed without any Cognito call', async () => {
    const { dir, cognito } = await setup();
    const created = await dir.createUser('new@example.com');
    expect(created).toMatchObject({ email: 'new@example.com', accountStatus: 'active', groups: ['user'] });

    cognito.getUser.mockClear();
    const page = await dir.listUsers({ filter: 'all' });
    expect(page.users).toEqual([
      expect.objectContaining({ id: created.id, email: 'new@example.com', status: 'FORCE_CHANGE_PASSWORD', groups: ['user'] }),
    ]);
    expect(cognito.getUser).not.toHaveBeenCalled();
  });

  it('refuses an email already in the table without calling Cognito', async () => {
    const { dir, cognito } = await setup();
    await dir.createUser('a@example.com');
    cognito.createUser.mockClear();
    await expect(dir.createUser('A@example.com')).rejects.toBeInstanceOf(UserExistsError);
    expect(cognito.createUser).not.toHaveBeenCalled();
  });

  it('rolls back the Cognito account if the table write fails', async () => {
    const { dir, cognito, store } = await setup();
    jest.spyOn(store, 'upsert').mockRejectedValueOnce(new Error('db down'));
    await expect(dir.createUser('a@example.com')).rejects.toThrow('db down');
    expect(cognito.purgeUser).toHaveBeenCalled();
    expect(cognito.pool.size).toBe(0);
  });

  describe('statusOf (every authenticated request)', () => {
    it('reads status from the table and records the first sign-in', async () => {
      const { dir, store } = await setup();
      const u = await dir.createUser('a@example.com');
      expect((await store.get(u.id))!.signedInAt).toBeNull();
      expect(await dir.statusOf(u.id, ['user'])).toBe('active');
      expect((await store.get(u.id))!.signedInAt).toBeInstanceOf(Date);
      expect((await dir.listUsers({ filter: 'all' })).users[0].status).toBe('CONFIRMED');
    });

    it('follows a role change from the token', async () => {
      const { dir, store } = await setup();
      const u = await dir.createUser('a@example.com');
      await dir.statusOf(u.id, ['admin']);
      expect((await store.get(u.id))!.role).toBe('admin');
    });

    it('adopts a Cognito user the table does not know, keeping their old group-based status', async () => {
      const { dir, store } = await setup([live('old', { accountStatus: 'inactive', groups: ['admin'] })]);
      expect(await dir.statusOf('old')).toBe('inactive');
      expect(await store.get('old')).toMatchObject({ email: 'old@example.com', role: 'admin', accountStatus: 'inactive' });
    });

    it('treats a user missing from both as deleted', async () => {
      const { dir } = await setup();
      expect(await dir.statusOf('ghost')).toBe('deleted');
    });

    it('replaces a stale row holding the same email under another id', async () => {
      const { dir, store } = await setup([live('new-id', { email: 'same@example.com' })]);
      await store.upsert({ id: 'old-id', email: 'same@example.com', role: 'user', accountStatus: 'deleted' });
      expect(await dir.statusOf('new-id')).toBe('active');
      expect(await store.get('old-id')).toBeNull();
    });
  });

  it('setStatus updates the table and revokes sessions unless reactivating', async () => {
    const { dir, store, cognito } = await setup();
    const u = await dir.createUser('a@example.com');
    await dir.setStatus(u.id, 'inactive');
    expect((await store.get(u.id))!.accountStatus).toBe('inactive');
    expect(cognito.revokeSessions).toHaveBeenCalledWith(u.id);
    cognito.revokeSessions.mockClear();
    await dir.setStatus(u.id, 'active');
    expect(cognito.revokeSessions).not.toHaveBeenCalled();
  });

  it('getUser merges live Cognito details with the stored status and role', async () => {
    const { dir } = await setup();
    const u = await dir.createUser('a@example.com');
    await dir.setStatus(u.id, 'deleted');
    const byEmail = await dir.getUser('a@example.com');
    expect(byEmail).toMatchObject({ id: u.id, accountStatus: 'deleted', identityProvider: 'Cognito', groups: ['user'] });
  });

  it('getUser marks a row whose Cognito user is gone as deleted', async () => {
    const { dir, cognito } = await setup();
    const u = await dir.createUser('a@example.com');
    cognito.pool.delete(u.id);
    expect(await dir.getUser(u.id)).toMatchObject({ accountStatus: 'deleted', enabled: false });
  });

  it('purgeUser removes the account from both', async () => {
    const { dir, store, cognito } = await setup();
    const u = await dir.createUser('a@example.com');
    await dir.purgeUser(u.id);
    expect(await store.get(u.id)).toBeNull();
    expect(cognito.pool.has(u.id)).toBe(false);
  });

  it('filters and searches the list', async () => {
    const { dir, store } = await setup();
    await dir.createUser('bob@example.com');
    const amy = await dir.createUser('amy@example.com');
    await store.update(amy.id, { role: 'admin' });
    expect((await dir.listUsers({ filter: 'admin' })).users.map((u) => u.email)).toEqual(['amy@example.com']);
    expect((await dir.listUsers({ filter: 'all', search: ' BO ' })).users.map((u) => u.email)).toEqual(['bob@example.com']);
  });

  it('backfills Cognito users the table lacks, leaving existing rows alone', async () => {
    const { dir, store } = await setup();
    await store.upsert({ id: 'known', email: 'known@example.com', role: 'user', accountStatus: 'inactive' });
    async function* pages() {
      yield [live('known', { accountStatus: 'active' }), live('a')];
      yield [live('b', { groups: ['admin'], status: 'FORCE_CHANGE_PASSWORD' })];
    }
    expect(await dir.syncFromCognito(pages())).toEqual({ added: 2, seen: 3 });
    expect((await store.get('known'))!.accountStatus).toBe('inactive'); // table wins
    expect(await store.get('b')).toMatchObject({ role: 'admin', signedInAt: null });
  });
});
