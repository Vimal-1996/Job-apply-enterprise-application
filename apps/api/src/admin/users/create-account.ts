import { Logger } from '@nestjs/common';
import { UserDetail, UserDirectory, UserExistsError } from './user.types';

const logger = new Logger('Accounts');

/**
 * Creates an account for `email` (user role, temporary password emailed).
 * A soft-deleted account with that email is replaced: the old record is
 * removed and a fresh account is created, so a deleted person can come back
 * by signing up again or being re-added. Any other existing account
 * (active, invited, deactivated) still raises UserExistsError, with `existing`
 * set so the caller can decide what to do.
 *
 * An administrator's email never becomes a normal user account: an admin
 * account is never replaced, even if it is marked deleted.
 */
export async function createFreshAccount(directory: UserDirectory, email: string): Promise<UserDetail> {
  try {
    return await directory.createUser(email);
  } catch (e) {
    if (!(e instanceof UserExistsError)) throw e;
    const existing = await directory.getUser(email); // the pool accepts the email as username
    if (existing?.accountStatus !== 'deleted' || isAdmin(existing)) throw Object.assign(e, { existing });
    logger.log(`replacing deleted account ${existing.id} with a fresh one`);
    await directory.purgeUser(existing.id);
    return directory.createUser(email);
  }
}

export function isAdmin(u: Pick<UserDetail, 'groups'>): boolean {
  return u.groups.includes('admin');
}

export type ExistingAccountError = UserExistsError & { existing?: UserDetail | null };
