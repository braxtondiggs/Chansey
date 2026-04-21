import { registerAs } from '@nestjs/config';

export interface TickerBatcherConfig {
  /** ms to wait after first enqueue before flushing the batch. */
  flushMs: number;
  /** Max symbols per batch; hitting this triggers an immediate flush. */
  maxBatchSize: number;
  /** Sub-second memCache TTL in ms to dedup repeated reads in the same tick. */
  memCacheTtlMs: number;
}

const parseInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const tickerBatcherConfig = registerAs(
  'tickerBatcher',
  (): TickerBatcherConfig => ({
    flushMs: parseInteger(process.env.TICKER_BATCHER_FLUSH_MS, 50),
    maxBatchSize: parseInteger(process.env.TICKER_BATCHER_MAX_BATCH_SIZE, 100),
    memCacheTtlMs: parseInteger(process.env.TICKER_BATCHER_MEM_CACHE_TTL_MS, 550)
  })
);
