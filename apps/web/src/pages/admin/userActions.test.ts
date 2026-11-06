import { describe, expect, it } from 'vitest';
import { availableActions } from './userActions';

describe('availableActions', () => {
  it('offers nothing for admins, whatever their status', () => {
    expect(availableActions({ groups: ['admin'], accountStatus: 'active' })).toEqual([]);
    expect(availableActions({ groups: ['admin', 'user'], accountStatus: 'inactive' })).toEqual([]);
  });
  it('lets an active user be deactivated or deleted', () => {
    expect(availableActions({ groups: ['user'], accountStatus: 'active' })).toEqual(['deactivate', 'delete']);
  });
  it('lets an inactive user be reactivated or deleted', () => {
    expect(availableActions({ groups: [], accountStatus: 'inactive' })).toEqual(['reactivate', 'delete']);
  });
  it('offers nothing once deleted', () => {
    expect(availableActions({ groups: ['user'], accountStatus: 'deleted' })).toEqual([]);
  });
});
