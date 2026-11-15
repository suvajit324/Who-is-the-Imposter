/**
 * Fixed-window counter kept in memory (single server instance, resets on restart).
 * Keys are never IP addresses: behind Render's proxy every client currently appears
 * to come from the same address, so an IP limit would lock everyone out at once.
 */
export class FixedWindowLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 10_000
  ) {}

  /** True when the key has used up its allowance for the current window. */
  isLimited(key: string): boolean {
    const entry = this.windows.get(key);
    return Boolean(entry && entry.resetAt > this.now() && entry.count >= this.limit);
  }

  /**
   * Checks and records in one synchronous step: returns false (recording nothing) when the
   * key is limited, otherwise counts this attempt and returns true. Callers that check now
   * and record after an `await` would let a burst of parallel requests all pass the check.
   */
  consume(key: string): boolean {
    if (this.isLimited(key)) return false;
    this.record(key);
    return true;
  }

  record(key: string): void {
    const now = this.now();
    const entry = this.windows.get(key);
    if (entry && entry.resetAt > now) {
      entry.count += 1;
      return;
    }
    if (this.windows.size >= this.maxKeys) this.prune(now);
    this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  private prune(now: number): void {
    for (const [key, entry] of this.windows) if (entry.resetAt <= now) this.windows.delete(key);
    // Still full of live windows: drop the oldest so memory stays bounded.
    while (this.windows.size >= this.maxKeys) {
      const oldest = this.windows.keys().next().value;
      if (oldest === undefined) break;
      this.windows.delete(oldest);
    }
  }
}
