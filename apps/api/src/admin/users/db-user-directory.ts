import { Logger } from '@nestjs/common';
import { AccountStatus, Role } from '../../auth/auth.types';
import { UserRow, UserStore } from '../../db/user-store';
import { CognitoUserDirectory } from './cognito-user-directory';
import { RoleFilter, UserDetail, UserDirectory, UserExistsError, UserPage, UserSummary } from './user.types';

const PAGE_SIZE = 50;

type CognitoSide = Pick<
  CognitoUserDirectory,
  'getUser' | 'createUser' | 'resendInvite' | 'purgeUser' | 'mfaEnabled' | 'revokeSessions'
>;

function roleOf(groups: Role[]): Role {
  return groups.includes('admin') ? 'admin' : 'user';
}

/** What the list shows, from the database alone (no Cognito call). */
export function rowToSummary(row: UserRow): UserSummary {
  return {
    id: row.id,
    email: row.email,
    emailVerified: true, // every account's email is verified: admins add it, or the user received the password there
    status: row.signedInAt ? 'CONFIRMED' : 'FORCE_CHANGE_PASSWORD',
    enabled: true,
    accountStatus: row.accountStatus,
    groups: [row.role],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Users, backed by the app's own Postgres table, with Cognito only where it
 * must be involved: passwords and invitation emails, sign-out, MFA and the
 * admin role. Account status is read from Postgres, so the per-request check
 * costs one indexed lookup instead of a Cognito call (Cognito's read APIs are
 * capped at a few dozen calls per second per account).
 *
 * Users that exist in Cognito but not yet in the table (created in the
 * console, or from before this table existed) are added the first time they
 * are seen, with their status taken from the old Cognito status groups.
 */
export class DbUserDirectory implements UserDirectory {
  private readonly logger = new Logger(DbUserDirectory.name);

  constructor(
    private readonly store: UserStore,
    private readonly cognito: CognitoSide,
    /** Removes the user's other data (their files) when the account is removed for good. */
    private readonly onPurge: (userId: string) => Promise<void> = async () => undefined,
  ) {}

  async listUsers({ filter, nextToken, search }: { filter: RoleFilter; nextToken?: string; search?: string }): Promise<UserPage> {
    const { rows, nextCursor } = await this.store.list({
      role: filter === 'all' ? undefined : filter,
      cursor: nextToken,
      search: search?.trim() || undefined,
      limit: PAGE_SIZE,
    });
    return { users: rows.map(rowToSummary), nextToken: nextCursor };
  }

  /** `idOrEmail`: the pool also accepts the email as a username. */
  async getUser(idOrEmail: string): Promise<UserDetail | null> {
    let row = idOrEmail.includes('@') ? await this.store.getByEmail(idOrEmail) : await this.store.get(idOrEmail);
    const live = await this.cognito.getUser(row?.id ?? idOrEmail);
    if (!live) {
      // In the table but gone from Cognito: removed outside the app, so it can't sign in.
      return row ? { ...rowToSummary(row), accountStatus: 'deleted', status: 'UNKNOWN', enabled: false, mfaMethods: [], preferredMfa: null, identityProvider: 'Cognito' } : null;
    }
    if (!row) row = await this.adopt(live);
    else if (row.role !== roleOf(live.groups)) {
      await this.store.update(row.id, { role: roleOf(live.groups) }); // admin role changed in Cognito
      row = { ...row, role: roleOf(live.groups) };
    }
    return { ...live, accountStatus: row.accountStatus, groups: [row.role] };
  }

  /**
   * Called on every authenticated request (cached briefly by the caller).
   * A valid token proves the user has signed in, so record that, and keep the
   * stored role in step with the token's.
   */
  async statusOf(userId: string, roles?: Role[]): Promise<AccountStatus> {
    let row = await this.store.get(userId);
    if (!row) {
      const live = await this.cognito.getUser(userId);
      if (!live) return 'deleted';
      row = await this.adopt(live);
    }
    const patch: Partial<Pick<UserRow, 'role' | 'signedInAt'>> = {};
    if (!row.signedInAt) patch.signedInAt = new Date();
    if (roles && row.role !== roleOf(roles)) patch.role = roleOf(roles);
    if (Object.keys(patch).length) await this.store.update(userId, patch);
    return row.accountStatus;
  }

  async setStatus(id: string, status: AccountStatus): Promise<void> {
    await this.store.update(id, { accountStatus: status });
    if (status !== 'active') await this.cognito.revokeSessions(id);
  }

  async createUser(email: string): Promise<UserDetail> {
    if (await this.store.getByEmail(email)) throw new UserExistsError(); // no Cognito call needed
    const created = await this.cognito.createUser(email); // throws UserExistsError if only Cognito has it
    try {
      await this.store.upsert({ id: created.id, email, role: 'user', accountStatus: 'active' });
    } catch (e) {
      // Keep Cognito and the table in step: don't leave an account the app doesn't know.
      this.logger.error(`storing new user ${created.id} failed, rolling back: ${(e as Error).message}`);
      await this.cognito.purgeUser(created.id).catch((d) => this.logger.error(`rollback failed: ${(d as Error).message}`));
      throw e;
    }
    return { ...created, accountStatus: 'active', groups: ['user'] };
  }

  resendInvite(id: string): Promise<void> {
    return this.cognito.resendInvite(id);
  }

  async purgeUser(id: string): Promise<void> {
    await this.onPurge(id); // files first: rows can be re-derived, orphaned files can't be found
    await this.cognito.purgeUser(id);
    await this.store.delete(id); // also deletes their resume rows (ON DELETE CASCADE)
  }

  mfaEnabled(id: string): Promise<boolean> {
    return this.cognito.mfaEnabled(id);
  }

  /**
   * One-off backfill: adds every Cognito user the table doesn't have yet.
   * Existing rows are left alone (the table is the source of truth for status).
   */
  async syncFromCognito(pages: AsyncIterable<UserSummary[]>): Promise<{ added: number; seen: number }> {
    let added = 0;
    let seen = 0;
    for await (const page of pages) {
      for (const u of page) {
        seen++;
        if (!(await this.store.get(u.id))) {
          await this.adopt(u);
          added++;
        }
      }
    }
    return { added, seen };
  }

  /** Adds a Cognito user the table doesn't know yet, keeping their old group-based status. */
  private async adopt(live: UserSummary): Promise<UserRow> {
    if (!live.email) throw new Error(`Cognito user ${live.id} has no email`);
    this.logger.log(`adding existing Cognito user ${live.id} to the database (status ${live.accountStatus})`);
    // Cognito allows one account per email, so a row with this email under
    // another id is stale (that Cognito user was removed); drop it.
    const stale = await this.store.getByEmail(live.email);
    if (stale && stale.id !== live.id) await this.store.delete(stale.id);
    const signedIn = live.status === 'CONFIRMED' || live.status === 'EXTERNAL_PROVIDER';
    return this.store.upsert({
      id: live.id,
      email: live.email,
      role: roleOf(live.groups),
      accountStatus: live.accountStatus,
      signedInAt: signedIn ? new Date(live.updatedAt ?? Date.now()) : null,
    });
  }
}
