import { describe, expect, it } from 'vitest';
import { groupsFromProfile, hasAnyRole, requiresMfa } from './roles';

describe('groupsFromProfile', () => {
  it('returns known groups only', () => {
    expect(groupsFromProfile({ 'cognito:groups': ['admin', 'other'] })).toEqual(['admin']);
  });
  it('handles missing or malformed claims', () => {
    expect(groupsFromProfile(undefined)).toEqual([]);
    expect(groupsFromProfile({ 'cognito:groups': 'admin' })).toEqual([]);
  });
});

describe('requiresMfa', () => {
  it('is required for admins only', () => {
    expect(requiresMfa(['admin'])).toBe(true);
    expect(requiresMfa(['admin', 'user'])).toBe(true);
    expect(requiresMfa(['user'])).toBe(false);
    expect(requiresMfa([])).toBe(false);
  });
});

describe('hasAnyRole', () => {
  it('passes with no requirement', () => expect(hasAnyRole([], [])).toBe(true));
  it('passes when one role matches', () => expect(hasAnyRole(['user'], ['admin', 'user'])).toBe(true));
  it('fails when none match', () => expect(hasAnyRole(['user'], ['admin'])).toBe(false));
});
