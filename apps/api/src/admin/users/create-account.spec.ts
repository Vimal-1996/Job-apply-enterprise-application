import { createFreshAccount } from './create-account';
import { UserDetail, UserExistsError } from './user.types';

const u = (over: Partial<UserDetail>): UserDetail => ({
  id: 'old',
  email: 'a@example.com',
  emailVerified: true,
  status: 'CONFIRMED',
  enabled: true,
  accountStatus: 'active',
  groups: ['user'],
  createdAt: null,
  updatedAt: null,
  mfaMethods: [],
  preferredMfa: null,
  identityProvider: 'Cognito',
  ...over,
});

function dir(existing: UserDetail | null) {
  let created = false;
  return {
    createUser: jest.fn(async () => {
      if (existing && !created) {
        created = true;
        throw new UserExistsError();
      }
      return u({ id: 'fresh', status: 'FORCE_CHANGE_PASSWORD' });
    }),
    getUser: jest.fn(async () => existing),
    purgeUser: jest.fn(async () => undefined),
  };
}

describe('createFreshAccount', () => {
  it('creates a new account', async () => {
    const d = dir(null);
    expect((await createFreshAccount(d as any, 'a@example.com')).id).toBe('fresh');
  });

  it('replaces a deleted normal user', async () => {
    const d = dir(u({ accountStatus: 'deleted' }));
    expect((await createFreshAccount(d as any, 'a@example.com')).id).toBe('fresh');
    expect(d.purgeUser).toHaveBeenCalledWith('old');
  });

  it.each([
    ['a live user', u({})],
    ['a deactivated user', u({ accountStatus: 'inactive' })],
    ['an admin', u({ groups: ['admin'] })],
    ['an admin marked deleted', u({ groups: ['admin'], accountStatus: 'deleted' })],
  ])('refuses to replace %s', async (_label, existing) => {
    const d = dir(existing);
    const err = await createFreshAccount(d as any, 'a@example.com').catch((e) => e);
    expect(err).toBeInstanceOf(UserExistsError);
    expect(err.existing).toBe(existing);
    expect(d.purgeUser).not.toHaveBeenCalled();
  });
});
