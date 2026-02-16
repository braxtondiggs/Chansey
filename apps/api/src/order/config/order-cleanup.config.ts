import { registerAs } from '@nestjs/config';

const parseInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parseNonNegativeInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

/**
 * Order Cleanup Configuration
 *
 * Controls the nightly cleanup job that removes terminal-state orders
 * to prevent unbounded table growth from exchange syncs.
 */
export interface OrderCleanupConfig {
  /** Whether the cleanup job is enabled. Default: true */
  enabled: boolean;

  /** Days to retain CANCELED/REJECTED/EXPIRED orders after last update. Default: 90 */
  terminalRetentionDays: number;

  /** Days before stale PENDING_CANCEL orders are removed. Default: 30 */
  stalePendingCancelDays: number;

  /** Number of orders to delete per transaction batch. Default: 500 */
  batchSize: number;

  /** Delay in ms between batches to reduce DB pressure. Default: 100 */
  batchDelayMs: number;

  /** When true, log what would be deleted without executing deletes. Default: false */
  dryRun: boolean;
}

export const orderCleanupConfig = registerAs(
  'orderCleanup',
  (): OrderCleanupConfig => ({
    enabled: process.env.ORDER_CLEANUP_ENABLED !== 'false',
    terminalRetentionDays: parseInteger(process.env.ORDER_CLEANUP_TERMINAL_RETENTION_DAYS, 90),
    stalePendingCancelDays: parseInteger(process.env.ORDER_CLEANUP_STALE_PENDING_CANCEL_DAYS, 30),
    batchSize: parseInteger(process.env.ORDER_CLEANUP_BATCH_SIZE, 500),
    batchDelayMs: parseNonNegativeInteger(process.env.ORDER_CLEANUP_BATCH_DELAY_MS, 100),
    dryRun: process.env.ORDER_CLEANUP_DRY_RUN === 'true'
  })
);
