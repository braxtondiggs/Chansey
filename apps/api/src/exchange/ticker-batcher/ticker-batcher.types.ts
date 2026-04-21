/**
 * Unified ticker shape returned by the batcher.
 * Callers adapt this to their own DTOs (e.g. PriceData, TickerPrice).
 */
export interface BatchedTicker {
  /** Unified symbol, e.g. "BTC/USDT" */
  symbol: string;
  /** last ?? close ?? 0 */
  price: number;
  bid?: number;
  ask?: number;
  high?: number;
  low?: number;
  change?: number;
  percentage?: number;
  baseVolume?: number;
  quoteVolume?: number;
  timestamp: Date;
  /** exchange slug that produced the ticker */
  source: string;
}

export interface PendingRequest {
  resolve: (ticker: BatchedTicker | undefined) => void;
  reject: (err: Error) => void;
}

export interface BatchState {
  /** Map of raw (pre-format) symbol → callers waiting on it. */
  pending: Map<string, PendingRequest[]>;
  /** Timer for the scheduled flush; null when no flush is armed. */
  timer: NodeJS.Timeout | null;
}
