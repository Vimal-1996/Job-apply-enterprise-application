import { AccountStatus, AccountStatusLookup } from './auth.types';

const MAX_ENTRIES = 10_000;

/**
 * Short-lived cache in front of the identity store so the per-request status
 * check doesn't cost a Cognito call every time. Admin actions call
 * `invalidate`, so a change takes effect immediately on this instance and
 * within `ttlMs` on any other.
 */
export class AccountStatusCache implements AccountStatusLookup {
  private readonly entries = new Map<string, { status: AccountStatus; expires: number }>();

  constructor(
    private readonly source: AccountStatusLookup,
    private readonly ttlMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  async statusOf(userId: string): Promise<AccountStatus> {
    const hit = this.entries.get(userId);
    if (hit && hit.expires > this.now()) return hit.status;
    const status = await this.source.statusOf(userId);
    if (this.entries.size >= MAX_ENTRIES) this.entries.clear();
    this.entries.set(userId, { status, expires: this.now() + this.ttlMs });
    return status;
  }

  invalidate(userId: string): void {
    this.entries.delete(userId);
  }
}
