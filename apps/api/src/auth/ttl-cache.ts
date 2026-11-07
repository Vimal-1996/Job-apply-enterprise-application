const MAX_ENTRIES = 10_000;

/**
 * Short-lived per-key cache in front of the identity store, so per-request
 * checks don't cost a Cognito call every time. Failures are not cached.
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expires: number }>();

  constructor(
    private readonly load: (key: string) => Promise<T>,
    private readonly ttlMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** `load` overrides the default loader for this miss (e.g. to pass extra context). */
  async get(key: string, load: (key: string) => Promise<T> = this.load): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > this.now()) return hit.value;
    const value = await load(key);
    if (this.entries.size >= MAX_ENTRIES) this.entries.clear();
    this.entries.set(key, { value, expires: this.now() + this.ttlMs });
    return value;
  }

  invalidate(key: string): void {
    this.entries.delete(key);
  }
}
