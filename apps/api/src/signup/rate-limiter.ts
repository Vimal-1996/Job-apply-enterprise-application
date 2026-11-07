/**
 * Fixed-window counters kept in memory. Good enough for one API instance;
 * with several instances behind a load balancer, move this to a shared store
 * (or WAF rate rules) so the limits hold across instances.
 */
export class WindowCounter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 10_000,
  ) {}

  /** Counts one hit for `key`; false once the key is over its limit for this window. */
  take(key: string): boolean {
    const t = this.now();
    let w = this.windows.get(key);
    if (!w || t - w.start >= this.windowMs) {
      if (!w && this.windows.size >= this.maxKeys) this.prune(t);
      w = { start: t, count: 0 };
      this.windows.set(key, w);
    }
    if (w.count >= this.limit) return false;
    w.count++;
    return true;
  }

  private prune(t: number) {
    for (const [k, w] of this.windows) if (t - w.start >= this.windowMs) this.windows.delete(k);
    if (this.windows.size >= this.maxKeys) this.windows.clear(); // under attack: fail open per-key, global cap still holds
  }
}
