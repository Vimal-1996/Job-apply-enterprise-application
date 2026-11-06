import {
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  AttributeType,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { Role } from '../../auth/auth.types';
import { RoleFilter, UserDetail, UserDirectory, UserPage, UserSummary } from './user.types';

const ROLES: Role[] = ['admin', 'user'];
const PAGE_SIZE = 50;

type Sender = Pick<CognitoIdentityProviderClient, 'send'>;

function attr(attrs: AttributeType[] | undefined, name: string): string | undefined {
  return attrs?.find((a) => a.Name === name)?.Value;
}

function identityProvider(attrs: AttributeType[] | undefined): string {
  const raw = attr(attrs, 'identities');
  if (!raw) return 'Cognito';
  try {
    const ids = JSON.parse(raw) as Array<{ providerName?: string }>;
    return ids[0]?.providerName ?? 'Cognito';
  } catch {
    return 'Cognito';
  }
}

/** Common shape of ListUsers' UserType and AdminGetUser's response. */
interface RawUser {
  Username?: string;
  attributes?: AttributeType[];
  UserStatus?: string;
  Enabled?: boolean;
  UserCreateDate?: Date;
  UserLastModifiedDate?: Date;
}

export function toSummary(u: RawUser, groups: Role[]): UserSummary {
  return {
    id: u.Username ?? '',
    email: attr(u.attributes, 'email') ?? null,
    emailVerified: attr(u.attributes, 'email_verified') === 'true',
    status: u.UserStatus ?? 'UNKNOWN',
    enabled: u.Enabled ?? false,
    groups,
    createdAt: u.UserCreateDate?.toISOString() ?? null,
    updatedAt: u.UserLastModifiedDate?.toISOString() ?? null,
  };
}

/**
 * Reads users from a Cognito user pool.
 * Group membership comes from one ListUsersInGroup sweep per role instead of
 * one call per user, so a page costs 1 + (number of roles) calls.
 */
export class CognitoUserDirectory implements UserDirectory {
  constructor(
    private readonly client: Sender,
    private readonly userPoolId: string,
  ) {}

  private async membersOf(group: Role): Promise<Set<string>> {
    const members = new Set<string>();
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListUsersInGroupCommand({ UserPoolId: this.userPoolId, GroupName: group, NextToken: token, Limit: 60 }),
      );
      res.Users?.forEach((u) => u.Username && members.add(u.Username));
      token = res.NextToken;
    } while (token);
    return members;
  }

  async listUsers({ filter, nextToken }: { filter: RoleFilter; nextToken?: string }): Promise<UserPage> {
    const membership = new Map<Role, Set<string>>();
    await Promise.all(ROLES.map(async (r) => membership.set(r, await this.membersOf(r))));
    const groupsOf = (username: string) => ROLES.filter((r) => membership.get(r)!.has(username));

    const res = await this.client.send(
      new ListUsersCommand({ UserPoolId: this.userPoolId, Limit: PAGE_SIZE, PaginationToken: nextToken }),
    );
    let users = (res.Users ?? []).map((u) => toSummary({ ...u, attributes: u.Attributes }, groupsOf(u.Username ?? '')));
    if (filter !== 'all') users = users.filter((u) => u.groups.includes(filter));
    users.sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''));
    return { users, nextToken: res.PaginationToken ?? null };
  }

  async getUser(id: string): Promise<UserDetail | null> {
    try {
      const [user, groups] = await Promise.all([
        this.client.send(new AdminGetUserCommand({ UserPoolId: this.userPoolId, Username: id })),
        this.client.send(new AdminListGroupsForUserCommand({ UserPoolId: this.userPoolId, Username: id })),
      ]);
      const roles = (groups.Groups ?? [])
        .map((g) => g.GroupName)
        .filter((g): g is Role => ROLES.includes(g as Role));
      return {
        ...toSummary({ ...user, attributes: user.UserAttributes }, roles),
        mfaMethods: user.UserMFASettingList ?? [],
        preferredMfa: user.PreferredMfaSetting ?? null,
        identityProvider: identityProvider(user.UserAttributes),
      };
    } catch (e) {
      if (e instanceof UserNotFoundException || (e as { name?: string }).name === 'UserNotFoundException') return null;
      throw e;
    }
  }
}
