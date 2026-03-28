/**
 * Thrown by engine loops when the application is shutting down
 * and an emergency checkpoint has been written.
 *
 * Processors catch this to distinguish a graceful shutdown abort
 * from a real execution failure — the backtest should stay RUNNING
 * (not FAILED) so recovery can pick it up on the next boot.
 */
export class BacktestAbortedError extends Error {
  constructor(backtestId: string) {
    super(`Backtest ${backtestId} aborted due to application shutdown`);
    this.name = 'BacktestAbortedError';
  }
}
