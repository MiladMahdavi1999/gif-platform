/** Bounded, process-local safety controls; no proxy headers are trusted. */
export class PublicLimiter {
  private windows = new Map<string, { count: number; until: number }>();
  constructor(
    private limit: number,
    private now = Date.now,
    private capacity = 10000,
  ) {}
  consume(peer: string) {
    const now = this.now();
    for (const [key, value] of this.windows)
      if (value.until <= now) this.windows.delete(key);
    const value = this.windows.get(peer);
    if (value && value.count >= this.limit)
      return Math.max(1, Math.ceil((value.until - now) / 1000));
    if (!value && this.windows.size >= this.capacity) return 60;
    this.windows.set(peer, {
      count: (value?.count ?? 0) + 1,
      until: value?.until ?? now + 60000,
    });
    return 0;
  }
}
