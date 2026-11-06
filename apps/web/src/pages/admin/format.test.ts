import { describe, expect, it } from 'vitest';
import type { UserSummary } from '../../api/types';
import { accountStatus, matchesSearch } from './format';

const u = (over: Partial<UserSummary> = {}): UserSummary => ({
  id: 'abc-123',
  email: 'Jane@Example.com',
  emailVerified: true,
  status: 'CONFIRMED',
  enabled: true,
  groups: ['user'],
  createdAt: null,
  updatedAt: null,
  ...over,
});

describe('accountStatus', () => {
  it('maps Cognito statuses to friendly labels', () => {
    expect(accountStatus(u())).toEqual({ label: 'Active', tone: 'success' });
    expect(accountStatus(u({ status: 'FORCE_CHANGE_PASSWORD' })).label).toBe('Invited');
  });
  it('shows Disabled regardless of status', () => {
    expect(accountStatus(u({ enabled: false }))).toEqual({ label: 'Disabled', tone: 'danger' });
  });
  it('falls back to a readable unknown status', () => {
    expect(accountStatus(u({ status: 'SOME_NEW_STATE' })).label).toBe('some new state');
  });
});

describe('matchesSearch', () => {
  it('matches email case-insensitively, or id', () => {
    expect(matchesSearch(u(), 'jane@')).toBe(true);
    expect(matchesSearch(u(), '123')).toBe(true);
    expect(matchesSearch(u(), 'bob')).toBe(false);
    expect(matchesSearch(u(), '  ')).toBe(true);
  });
});
