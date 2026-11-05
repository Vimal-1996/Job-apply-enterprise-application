import { describe, expect, it } from 'vitest';
import { groupsFromProfile, hasAnyRole } from './roles';

describe('groupsFromProfile', () => {
  it('returns known groups only', () => {
    expect(groupsFromProfile({ 'cognito:groups': ['admin', 'other'] })).toEqual(['admin']);
  });
  it('handles missing or malformed claims', () => {
    expect(groupsFromProfile(undefined)).toEqual([]);
    expect(groupsFromProfile({ 'cognito:groups': 'admin' })).toEqual([]);
  });
});

describe('hasAnyRole', () => {
  it('passes with no requirement', () => expect(hasAnyRole([], [])).toBe(true));
  it('passes when one role matches', () => expect(hasAnyRole(['user'], ['admin', 'user'])).toBe(true));
  it('fails when none match', () => expect(hasAnyRole(['user'], ['admin'])).toBe(false));
});
