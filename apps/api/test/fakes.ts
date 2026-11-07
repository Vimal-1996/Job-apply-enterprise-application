import { AccountStatus } from '../src/auth/auth.types';
import { UserDetail, UserDirectory, UserExistsError } from '../src/admin/users/user.types';

export type Claims = { sub: string; client_id: string; 'cognito:groups'?: string[] };

/** Fake verifier: maps a token string to claims and rejects the rest. */
export const fakeVerifier = (tokens: Record<string, Claims>) => ({
  verify: async (t: string) => {
    if (!tokens[t]) throw new Error('bad token');
    return tokens[t];
  },
});

export const detail = (id: string, over: Partial<UserDetail> = {}): UserDetail => ({
  id,
  email: `${id}@example.com`,
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

/** In-memory directory seeded with users; status changes are applied to the store. */
export function fakeDirectory(seed: UserDetail[]) {
  const store = new Map<string, UserDetail>();
  const reset = () => {
    store.clear();
    seed.forEach((u) => store.set(u.id, { ...u }));
  };
  reset();
  const dir = {
    reset,
    listUsers: jest.fn<ReturnType<UserDirectory['listUsers']>, Parameters<UserDirectory['listUsers']>>(async () => ({
      users: [...store.values()].map(({ mfaMethods, preferredMfa, identityProvider, ...s }) => s),
      nextToken: null,
    })),
    getUser: jest.fn(async (idOrEmail: string) => {
      const u = store.get(idOrEmail) ?? [...store.values()].find((x) => x.email === idOrEmail);
      return u ? { ...u } : null;
    }),
    statusOf: jest.fn(async (id: string): Promise<AccountStatus> => store.get(id)?.accountStatus ?? 'deleted'),
    setStatus: jest.fn(async (id: string, status: AccountStatus) => {
      store.get(id)!.accountStatus = status;
    }),
    createUser: jest.fn(async (email: string) => {
      if ([...store.values()].some((u) => u.email === email)) throw new UserExistsError();
      const u = detail(`new-${store.size}`, { email, status: 'FORCE_CHANGE_PASSWORD', emailVerified: true });
      store.set(u.id, u);
      return { ...u };
    }),
    resendInvite: jest.fn(async (_id: string) => undefined),
    // Admins are seeded with MFA on; tests can switch it off per user.
    mfaEnabled: jest.fn(async (id: string) => store.get(id)?.mfaMethods.includes('SOFTWARE_TOKEN_MFA') ?? false),
  };
  return dir satisfies UserDirectory & { reset: () => void };
}
