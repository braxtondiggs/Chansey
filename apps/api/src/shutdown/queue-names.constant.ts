/**
 * Central registry of all BullMQ queue names used in the application.
 * This ensures consistency across queue registration, injection, and monitoring.
 */
export const QUEUE_NAMES = [
  'balance-queue',
  'backtest-historical',
  'backtest-orchestration',
  'backtest-replay',
  'category-queue',
  'coin-queue',
  'drift-detection-queue',
  'exchange-queue',
  'optimization',
  'order-queue',
  'paper-trading',
  'performance-ranking',
  'pipeline',
  'pipeline-orchestration',
  'portfolio-queue',
  'price-queue',
  'regime-check-queue',
  'strategy-evaluation-queue',
  'ticker-pairs-queue',
  'trade-execution',
  'user-queue'
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];
