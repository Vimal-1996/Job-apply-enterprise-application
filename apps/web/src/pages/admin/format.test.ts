import { describe, expect, it } from 'vitest';
import type { UserSummary } from '../../api/types';
import { accountStatus, looksLikeEmail } from './format';

const u = (over: Partial<UserSummary> = {}): UserSummary => ({
  id: 'abc-123',
  email: 'Jane@Example.com',
  emailVerified: true,
  status: 'CONFIRMED',
  enabled: true,
  accountStatus: 'active',
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
  it('shows Inactive and Deleted over every Cognito state', () => {
    expect(accountStatus(u({ accountStatus: 'inactive' }))).toEqual({ label: 'Inactive', tone: 'warning' });
    expect(accountStatus(u({ accountStatus: 'deleted', enabled: false }))).toEqual({ label: 'Deleted', tone: 'danger' });
  });
  it('falls back to a readable unknown status', () => {
    expect(accountStatus(u({ status: 'SOME_NEW_STATE' })).label).toBe('some new state');
  });
});

describe('looksLikeEmail', () => {
  it('accepts ordinary addresses, trimmed', () => {
    expect(looksLikeEmail(' jane+jobs@example.co.uk ')).toBe(true);
  });
  it('rejects obvious mistakes', () => {
    for (const bad of ['', 'jane', 'jane@', 'jane@example', 'ja ne@example.com', 'a@b@c.com']) expect(looksLikeEmail(bad)).toBe(false);
  });
});
