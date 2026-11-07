import { migrate } from './migrate';
import { memoryPool } from './pg-mem';
import { decodeCursor, encodeCursor, PgUserStore } from './user-store';

describe('migrate', () => {
  it('applies the migrations once, and is a no-op the second time', async () => {
    const pool = memoryPool();
    expect(await migrate(pool)).toEqual(['001_app_user.sql']);
    expect(await migrate(pool)).toEqual([]);
  });
});

describe('PgUserStore', () => {
  let store: PgUserStore;

  beforeEach(async () => {
    const pool = memoryPool();
    await migrate(pool);
    store = new PgUserStore(pool);
  });

  const add = (id: string, email: string, over: object = {}) =>
    store.upsert({ id, email, role: 'user', accountStatus: 'active', ...over });

  it('inserts, reads by id or email (case-insensitive), and updates', async () => {
    const row = await add('u1', 'Jane@Example.com');
    expect(row).toMatchObject({ id: 'u1', email: 'jane@example.com', role: 'user', accountStatus: 'active', signedInAt: null });
    expect((await store.getByEmail('JANE@example.com'))?.id).toBe('u1');

    const signedIn = new Date('2026-11-07T10:00:00Z');
    await store.update('u1', { accountStatus: 'inactive', signedInAt: signedIn });
    expect(await store.get('u1')).toMatchObject({ accountStatus: 'inactive', signedInAt: signedIn });
    expect(await store.get('missing')).toBeNull();
  });

  it('upsert updates an existing id', async () => {
    await add('u1', 'a@example.com');
    await add('u1', 'a@example.com', { role: 'admin', accountStatus: 'deleted' });
    expect(await store.get('u1')).toMatchObject({ role: 'admin', accountStatus: 'deleted' });
  });

  it('enforces one account per email', async () => {
    await add('u1', 'a@example.com');
    await expect(add('u2', 'A@example.com')).rejects.toThrow();
  });

  it('deletes', async () => {
    await add('u1', 'a@example.com');
    await store.delete('u1');
    expect(await store.get('u1')).toBeNull();
  });

  it('pages in email order with a stable cursor, filtered by role and email prefix', async () => {
    for (const [id, email, role] of [
      ['1', 'dan@x.com', 'user'],
      ['2', 'amy@x.com', 'admin'],
      ['3', 'bob@x.com', 'user'],
      ['4', 'cat@x.com', 'user'],
      ['5', 'bo_b@x.com', 'user'],
    ] as const) {
      await add(id, email, { role });
    }

    const p1 = await store.list({ limit: 2 });
    expect(p1.rows.map((r) => r.email)).toEqual(['amy@x.com', 'bo_b@x.com']);
    const p2 = await store.list({ limit: 2, cursor: p1.nextCursor! });
    expect(p2.rows.map((r) => r.email)).toEqual(['bob@x.com', 'cat@x.com']);
    const p3 = await store.list({ limit: 2, cursor: p2.nextCursor! });
    expect(p3.rows.map((r) => r.email)).toEqual(['dan@x.com']);
    expect(p3.nextCursor).toBeNull();

    expect((await store.list({ limit: 10, role: 'admin' })).rows.map((r) => r.id)).toEqual(['2']);
    expect((await store.list({ limit: 10, search: 'BO' })).rows.map((r) => r.email)).toEqual(['bo_b@x.com', 'bob@x.com']);
    // "_" is literal, not a wildcard
    expect((await store.list({ limit: 10, search: 'bo_' })).rows.map((r) => r.email)).toEqual(['bo_b@x.com']);
  });
});

describe('cursor helpers', () => {
  it('round-trips cursors and rejects junk', () => {
    expect(decodeCursor(encodeCursor('a@x.com', 'id1'))).toEqual(['a@x.com', 'id1']);
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor(Buffer.from('[1,2]').toString('base64url'))).toBeNull();
  });
});
