import { describe, expect, it } from 'vitest';
import { availableActions } from './userActions';

describe('availableActions', () => {
  it('offers nothing for admins, whatever their status', () => {
    expect(availableActions({ groups: ['admin'], accountStatus: 'active', status: 'CONFIRMED' })).toEqual([]);
    expect(availableActions({ groups: ['admin', 'user'], accountStatus: 'inactive', status: 'CONFIRMED' })).toEqual([]);
  });
  it('lets an active user be deactivated or deleted', () => {
    expect(availableActions({ groups: ['user'], accountStatus: 'active', status: 'CONFIRMED' })).toEqual(['deactivate', 'delete']);
  });
  it('lets an inactive user be reactivated or deleted', () => {
    expect(availableActions({ groups: [], accountStatus: 'inactive', status: 'FORCE_CHANGE_PASSWORD' })).toEqual(['reactivate', 'delete']);
  });
  it('lets an invited user be sent a new invitation', () => {
    expect(availableActions({ groups: ['user'], accountStatus: 'active', status: 'FORCE_CHANGE_PASSWORD' })).toEqual([
      'resend-invite',
      'deactivate',
      'delete',
    ]);
  });
  it('offers nothing once deleted', () => {
    expect(availableActions({ groups: ['user'], accountStatus: 'deleted', status: 'FORCE_CHANGE_PASSWORD' })).toEqual([]);
  });
});
