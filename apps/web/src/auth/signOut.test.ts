import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./oidc', () => ({ cognitoLogoutUrl: () => 'https://cognito.example/logout' }));
const { isSigningOut, resetSignOutForTests, signOut, subscribeSigningOut } = await import('./signOut');

describe('signOut', () => {
  beforeEach(() => resetSignOutForTests());

  it('raises the flag before removing the user, so guards never start a sign-in', async () => {
    const seen: boolean[] = [];
    const auth = { removeUser: vi.fn(async () => void seen.push(isSigningOut())) };
    const navigate = vi.fn();
    await signOut(auth, navigate);
    expect(seen).toEqual([true]);
    expect(navigate).toHaveBeenCalledWith('https://cognito.example/logout');
  });

  it('notifies subscribers', async () => {
    const cb = vi.fn();
    const unsubscribe = subscribeSigningOut(cb);
    await signOut({ removeUser: async () => {} }, () => {});
    unsubscribe();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('still goes to Cognito logout if clearing local state fails', async () => {
    const navigate = vi.fn();
    await expect(signOut({ removeUser: async () => Promise.reject(new Error('storage')) }, navigate)).rejects.toThrow();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('ignores repeat clicks', async () => {
    const auth = { removeUser: vi.fn(async () => {}) };
    const navigate = vi.fn();
    await Promise.all([signOut(auth, navigate), signOut(auth, navigate)]);
    expect(auth.removeUser).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
