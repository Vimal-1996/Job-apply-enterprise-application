import { describe, expect, it } from 'vitest';
import type { UserSummary } from '../../api/types';
import { computeStats, newest } from './stats';

const u = (id: string, over: Partial<UserSummary> = {}): UserSummary => ({
  id,
  email: `${id}@example.com`,
  emailVerified: true,
  status: 'CONFIRMED',
  enabled: true,
  accountStatus: 'active',
  groups: ['user'],
  createdAt: null,
  updatedAt: null,
  ...over,
});

describe('computeStats', () => {
  it('counts roles and account states', () => {
    const s = computeStats(
      [
        u('admin', { groups: ['admin'] }),
        u('active'),
        u('google', { status: 'EXTERNAL_PROVIDER' }),
        u('invited', { status: 'FORCE_CHANGE_PASSWORD' }),
        u('off', { enabled: false }),
        u('inactive', { accountStatus: 'inactive' }),
        u('deleted', { accountStatus: 'deleted' }),
      ],
      true,
    );
    expect(s).toEqual({ total: 7, more: true, admins: 1, users: 6, active: 3, pending: 1, disabled: 3 });
  });

  it('does not count a disabled invite as pending', () => {
    expect(computeStats([u('x', { status: 'FORCE_CHANGE_PASSWORD', enabled: false })], false).pending).toBe(0);
  });
});

describe('newest', () => {
  it('sorts by creation date, newest first, undated last', () => {
    const list = [u('old', { createdAt: '2026-01-01T00:00:00Z' }), u('none'), u('new', { createdAt: '2026-11-01T00:00:00Z' })];
    expect(newest(list, 3).map((x) => x.id)).toEqual(['new', 'old', 'none']);
    expect(newest(list, 1).map((x) => x.id)).toEqual(['new']);
  });
});
