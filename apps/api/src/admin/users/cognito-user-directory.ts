import {
  AdminAddUserToGroupCommand,
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminUserGlobalSignOutCommand,
  AttributeType,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { AccountStatus, Role, STATUS_GROUPS, statusFromGroups } from '../../auth/auth.types';
import { RoleFilter, UserDetail, UserDirectory, UserPage, UserSummary } from './user.types';

const ROLES: Role[] = ['admin', 'user'];
/** Every group the directory reads membership of: roles plus status markers. */
const GROUPS: string[] = [...ROLES, STATUS_GROUPS.inactive, STATUS_GROUPS.deleted];
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

function isNotFound(e: unknown): boolean {
  return e instanceof UserNotFoundException || (e as { name?: string }).name === 'UserNotFoundException';
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

/** `groups` is the raw Cognito group list; roles and status are derived from it. */
export function toSummary(u: RawUser, groups: string[]): UserSummary {
  return {
    id: u.Username ?? '',
    email: attr(u.attributes, 'email') ?? null,
    emailVerified: attr(u.attributes, 'email_verified') === 'true',
    status: u.UserStatus ?? 'UNKNOWN',
    enabled: u.Enabled ?? false,
    accountStatus: statusFromGroups(groups),
    groups: ROLES.filter((r) => groups.includes(r)),
    createdAt: u.UserCreateDate?.toISOString() ?? null,
    updatedAt: u.UserLastModifiedDate?.toISOString() ?? null,
  };
}

/**
 * Reads and updates users in a Cognito user pool.
 * Group membership comes from one ListUsersInGroup sweep per group instead of
 * one call per user, so a page costs 1 + (number of groups) calls.
 */
export class CognitoUserDirectory implements UserDirectory {
  constructor(
    private readonly client: Sender,
    private readonly userPoolId: string,
  ) {}

  private async membersOf(group: string): Promise<Set<string>> {
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

  private async groupsOf(id: string): Promise<string[]> {
    const res = await this.client.send(new AdminListGroupsForUserCommand({ UserPoolId: this.userPoolId, Username: id }));
    return (res.Groups ?? []).map((g) => g.GroupName ?? '');
  }

  async listUsers({ filter, nextToken }: { filter: RoleFilter; nextToken?: string }): Promise<UserPage> {
    const membership = new Map<string, Set<string>>();
    await Promise.all(GROUPS.map(async (g) => membership.set(g, await this.membersOf(g))));
    const groupsOf = (username: string) => GROUPS.filter((g) => membership.get(g)!.has(username));

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
        this.groupsOf(id),
      ]);
      return {
        ...toSummary({ ...user, attributes: user.UserAttributes }, groups),
        mfaMethods: user.UserMFASettingList ?? [],
        preferredMfa: user.PreferredMfaSetting ?? null,
        identityProvider: identityProvider(user.UserAttributes),
      };
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  /** A user removed from the pool outside this app counts as deleted. */
  async statusOf(id: string): Promise<AccountStatus> {
    try {
      return statusFromGroups(await this.groupsOf(id));
    } catch (e) {
      if (isNotFound(e)) return 'deleted';
      throw e;
    }
  }

  async setStatus(id: string, status: AccountStatus): Promise<void> {
    const base = { UserPoolId: this.userPoolId, Username: id };
    if (status === 'active') {
      await this.client.send(new AdminRemoveUserFromGroupCommand({ ...base, GroupName: STATUS_GROUPS.inactive }));
      return;
    }
    await this.client.send(new AdminAddUserToGroupCommand({ ...base, GroupName: STATUS_GROUPS[status] }));
    // Revoke refresh tokens so the session can't be renewed. Access tokens that
    // are already out are rejected by the API's live status check.
    await this.client.send(new AdminUserGlobalSignOutCommand(base));
  }
}
