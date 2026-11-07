import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminUserGlobalSignOutCommand,
  ListUsersCommand,
  ListUsersInGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { CognitoUserDirectory } from './cognito-user-directory';

const created = new Date('2026-11-01T10:00:00Z');
const user = (id: string, email: string, extra: object = {}) => ({
  Username: id,
  Attributes: [
    { Name: 'email', Value: email },
    { Name: 'email_verified', Value: 'true' },
  ],
  UserStatus: 'CONFIRMED',
  Enabled: true,
  UserCreateDate: created,
  UserLastModifiedDate: created,
  ...extra,
});

/** Minimal fake of the SDK client: routes each command type to a handler. */
function fakeClient(handlers: Partial<Record<string, (input: any) => unknown>>) {
  const calls: string[] = [];
  return {
    calls,
    send: jest.fn(async (cmd: { constructor: { name: string }; input: unknown }) => {
      calls.push(cmd.constructor.name);
      const h = handlers[cmd.constructor.name];
      if (!h) throw new Error(`unexpected ${cmd.constructor.name}`);
      return h(cmd.input);
    }),
  };
}

describe('CognitoUserDirectory.listUsers', () => {
  const client = fakeClient({
    [ListUsersInGroupCommand.name]: (i) =>
      ({
        admin: { Users: [{ Username: 'a1' }] },
        user: { Users: [{ Username: 'u1' }, { Username: 'u2' }] },
        inactive: { Users: [{ Username: 'u1' }] },
        deleted: { Users: [{ Username: 'u2' }, { Username: 'n1' }] },
      })[i.GroupName as string],
    [ListUsersCommand.name]: () => ({
      Users: [user('u2', 'zoe@example.com'), user('a1', 'amy@example.com'), user('u1', 'bob@example.com'), user('n1', 'nora@example.com')],
      PaginationToken: 'next-page',
    }),
  });
  const dir = new CognitoUserDirectory(client as any, 'us-east-1_pool');

  it('maps users, attaches groups, and sorts by email', async () => {
    const page = await dir.listUsers({ filter: 'all' });
    expect(page.nextToken).toBe('next-page');
    expect(page.users.map((u) => [u.email, u.groups])).toEqual([
      ['amy@example.com', ['admin']],
      ['bob@example.com', ['user']],
      ['nora@example.com', []],
      ['zoe@example.com', ['user']],
    ]);
    expect(page.users[0]).toMatchObject({
      id: 'a1',
      emailVerified: true,
      status: 'CONFIRMED',
      enabled: true,
      createdAt: created.toISOString(),
    });
  });

  it('derives account status from the status groups', async () => {
    const page = await dir.listUsers({ filter: 'all' });
    expect(Object.fromEntries(page.users.map((u) => [u.id, u.accountStatus]))).toEqual({
      a1: 'active',
      u1: 'inactive',
      u2: 'deleted',
      n1: 'deleted',
    });
  });

  it('filters by role', async () => {
    const admins = await dir.listUsers({ filter: 'admin' });
    expect(admins.users.map((u) => u.id)).toEqual(['a1']);
    const users = await dir.listUsers({ filter: 'user' });
    expect(users.users.map((u) => u.id)).toEqual(['u1', 'u2']);
  });

  it('does not return anything beyond the summary fields', async () => {
    const page = await dir.listUsers({ filter: 'all' });
    expect(Object.keys(page.users[0]).sort()).toEqual(
      ['accountStatus', 'createdAt', 'email', 'emailVerified', 'enabled', 'groups', 'id', 'status', 'updatedAt'].sort(),
    );
  });
});

describe('CognitoUserDirectory.getUser', () => {
  it('returns detail with MFA and identity provider', async () => {
    const client = fakeClient({
      [AdminGetUserCommand.name]: () => ({
        Username: 'g1',
        UserAttributes: [
          { Name: 'email', Value: 'g@example.com' },
          { Name: 'identities', Value: JSON.stringify([{ providerName: 'Google' }]) },
        ],
        UserStatus: 'EXTERNAL_PROVIDER',
        Enabled: true,
        UserMFASettingList: ['SOFTWARE_TOKEN_MFA'],
        PreferredMfaSetting: 'SOFTWARE_TOKEN_MFA',
      }),
      [AdminListGroupsForUserCommand.name]: () => ({ Groups: [{ GroupName: 'user' }, { GroupName: 'unknown' }] }),
    });
    const u = await new CognitoUserDirectory(client as any, 'p').getUser('g1');
    expect(u).toMatchObject({
      id: 'g1',
      email: 'g@example.com',
      groups: ['user'],
      mfaMethods: ['SOFTWARE_TOKEN_MFA'],
      preferredMfa: 'SOFTWARE_TOKEN_MFA',
      identityProvider: 'Google',
      accountStatus: 'active',
    });
  });

  it('returns null for a missing user', async () => {
    const notFound = () => {
      throw Object.assign(new Error('nope'), { name: 'UserNotFoundException' });
    };
    const client = fakeClient({ [AdminGetUserCommand.name]: notFound, [AdminListGroupsForUserCommand.name]: notFound });
    expect(await new CognitoUserDirectory(client as any, 'p').getUser('x')).toBeNull();
  });
});

describe('CognitoUserDirectory.statusOf', () => {
  const dirWith = (groups: string[] | 'missing') =>
    new CognitoUserDirectory(
      fakeClient({
        [AdminListGroupsForUserCommand.name]: () => {
          if (groups === 'missing') throw Object.assign(new Error('nope'), { name: 'UserNotFoundException' });
          return { Groups: groups.map((GroupName) => ({ GroupName })) };
        },
      }) as any,
      'p',
    );

  it('reads status from group membership', async () => {
    expect(await dirWith(['user']).statusOf('x')).toBe('active');
    expect(await dirWith(['user', 'inactive']).statusOf('x')).toBe('inactive');
    expect(await dirWith(['inactive', 'deleted']).statusOf('x')).toBe('deleted');
  });

  it('treats a user missing from the pool as deleted', async () => {
    expect(await dirWith('missing').statusOf('x')).toBe('deleted');
  });
});

describe('CognitoUserDirectory.setStatus', () => {
  const run = async (status: 'active' | 'inactive' | 'deleted') => {
    const inputs: any[] = [];
    const ok = (i: unknown) => (inputs.push(i), {});
    const client = fakeClient({
      [AdminAddUserToGroupCommand.name]: ok,
      [AdminRemoveUserFromGroupCommand.name]: ok,
      [AdminUserGlobalSignOutCommand.name]: ok,
    });
    await new CognitoUserDirectory(client as any, 'p').setStatus('u1', status);
    return { calls: client.calls, inputs };
  };

  it('deactivates by adding to the inactive group and signing out everywhere', async () => {
    const { calls, inputs } = await run('inactive');
    expect(calls).toEqual([AdminAddUserToGroupCommand.name, AdminUserGlobalSignOutCommand.name]);
    expect(inputs[0]).toEqual({ UserPoolId: 'p', Username: 'u1', GroupName: 'inactive' });
  });

  it('soft-deletes by adding to the deleted group and signing out everywhere', async () => {
    const { calls, inputs } = await run('deleted');
    expect(calls).toEqual([AdminAddUserToGroupCommand.name, AdminUserGlobalSignOutCommand.name]);
    expect(inputs[0].GroupName).toBe('deleted');
  });

  it('reactivates by leaving the inactive group', async () => {
    const { calls, inputs } = await run('active');
    expect(calls).toEqual([AdminRemoveUserFromGroupCommand.name]);
    expect(inputs[0].GroupName).toBe('inactive');
  });
});

describe('CognitoUserDirectory.createUser', () => {
  const getUser = () => ({ Username: 'new-sub', UserAttributes: [{ Name: 'email', Value: 'n@example.com' }], UserStatus: 'FORCE_CHANGE_PASSWORD', Enabled: true });

  it('creates a verified, emailed user with the user role', async () => {
    const inputs: Record<string, any> = {};
    const client = fakeClient({
      [AdminCreateUserCommand.name]: (i) => ((inputs.create = i), { User: { Username: 'new-sub' } }),
      [AdminAddUserToGroupCommand.name]: (i) => ((inputs.group = i), {}),
      [AdminGetUserCommand.name]: getUser,
      [AdminListGroupsForUserCommand.name]: () => ({ Groups: [{ GroupName: 'user' }] }),
    });
    const u = await new CognitoUserDirectory(client as any, 'p').createUser('n@example.com');
    expect(inputs.create).toEqual({
      UserPoolId: 'p',
      Username: 'n@example.com',
      UserAttributes: [
        { Name: 'email', Value: 'n@example.com' },
        { Name: 'email_verified', Value: 'true' },
      ],
      DesiredDeliveryMediums: ['EMAIL'],
    });
    expect(inputs.create).not.toHaveProperty('TemporaryPassword'); // Cognito generates it
    expect(inputs.create).not.toHaveProperty('MessageAction'); // i.e. the email is sent
    expect(inputs.group).toEqual({ UserPoolId: 'p', Username: 'new-sub', GroupName: 'user' });
    expect(u).toMatchObject({ id: 'new-sub', status: 'FORCE_CHANGE_PASSWORD', groups: ['user'], accountStatus: 'active' });
  });

  it('maps an existing email to UserExistsError', async () => {
    const client = fakeClient({
      [AdminCreateUserCommand.name]: () => {
        throw Object.assign(new Error('exists'), { name: 'UsernameExistsException' });
      },
    });
    await expect(new CognitoUserDirectory(client as any, 'p').createUser('n@example.com')).rejects.toThrow(
      'An account with this email already exists',
    );
  });

  it('deletes the new account if the role cannot be assigned', async () => {
    const client = fakeClient({
      [AdminCreateUserCommand.name]: () => ({ User: { Username: 'new-sub' } }),
      [AdminAddUserToGroupCommand.name]: () => {
        throw new Error('throttled');
      },
      [AdminDeleteUserCommand.name]: () => ({}),
    });
    await expect(new CognitoUserDirectory(client as any, 'p').createUser('n@example.com')).rejects.toThrow('throttled');
    expect(client.calls).toContain(AdminDeleteUserCommand.name);
  });
});

describe('CognitoUserDirectory.resendInvite', () => {
  it('asks Cognito to resend with a new temporary password', async () => {
    let input: any;
    const client = fakeClient({ [AdminCreateUserCommand.name]: (i) => ((input = i), {}) });
    await new CognitoUserDirectory(client as any, 'p').resendInvite('u1');
    expect(input).toEqual({ UserPoolId: 'p', Username: 'u1', MessageAction: 'RESEND', DesiredDeliveryMediums: ['EMAIL'] });
  });
});
