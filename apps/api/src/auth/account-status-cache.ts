import { AccountStatus, AccountStatusLookup, MfaLookup } from './auth.types';
import { TtlCache } from './ttl-cache';

/**
 * Cached account status. Admin actions call `invalidate`, so a change takes
 * effect immediately on this instance and within `ttlMs` on any other.
 */
export class AccountStatusCache implements AccountStatusLookup {
  private readonly cache: TtlCache<AccountStatus>;

  constructor(source: AccountStatusLookup, ttlMs = 30_000, now: () => number = Date.now) {
    this.cache = new TtlCache((id) => source.statusOf(id), ttlMs, now);
  }

  statusOf(userId: string): Promise<AccountStatus> {
    return this.cache.get(userId);
  }

  invalidate(userId: string): void {
    this.cache.invalidate(userId);
  }
}

/** Cached MFA state; checked only on admin routes. */
export class MfaCache implements MfaLookup {
  private readonly cache: TtlCache<boolean>;

  constructor(source: MfaLookup, ttlMs = 30_000, now: () => number = Date.now) {
    this.cache = new TtlCache((id) => source.mfaEnabled(id), ttlMs, now);
  }

  mfaEnabled(userId: string): Promise<boolean> {
    return this.cache.get(userId);
  }
}
