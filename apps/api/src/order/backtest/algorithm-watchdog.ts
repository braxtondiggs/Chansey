/**
 * Tracks wall-clock time since the last successful algorithm execution and
 * throws if the elapsed time exceeds a configurable stall timeout.
 *
 * Replaces the duplicated `lastSuccessfulAlgoTime` / `Date.now()` pattern in
 * both `executeHistoricalBacktest` and `executeLiveReplayBacktest`.
 */
export class AlgorithmWatchdog {
  private lastSuccessTime: number;

  constructor(private readonly stallTimeoutMs: number) {
    this.lastSuccessTime = Date.now();
  }

  /** Record a successful algorithm execution (resets the timer). */
  recordSuccess(): void {
    this.lastSuccessTime = Date.now();
  }

  /**
   * Check whether the algorithm has stalled.
   * @param label Human-readable iteration label included in the error message.
   * @throws {Error} if elapsed time since last success exceeds the timeout.
   */
  checkStall(label: string): void {
    const elapsed = Date.now() - this.lastSuccessTime;
    if (elapsed > this.stallTimeoutMs) {
      throw new Error(`Algorithm stalled for ${this.stallTimeoutMs}ms at iteration ${label}`);
    }
  }
}
