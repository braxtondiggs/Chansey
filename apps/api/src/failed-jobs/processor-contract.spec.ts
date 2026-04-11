import 'reflect-metadata';

import { FailSafeWorkerHost } from './fail-safe-worker-host';

import { PerformanceRankingTask } from '../algorithm/tasks/performance-ranking.task';
import { BalanceSyncTask } from '../balance/tasks/balance-sync.task';
import { CategorySyncTask } from '../category/tasks/category-sync.task';
import { CoinSnapshotPruneTask } from '../coin/tasks/coin-snapshot-prune.task';
import { CoinSyncTask } from '../coin/tasks/coin-sync.task';
import { TickerPairSyncTask } from '../coin/ticker-pairs/tasks/ticker-pairs-sync.task';
import { CoinSelectionHistoricalPriceTask } from '../coin-selection/tasks/coin-selection-historical-price.task';
import { ExchangeKeyHealthTask } from '../exchange/exchange-key/tasks/exchange-key-health.task';
import { ExchangeSyncTask } from '../exchange/tasks/exchange-sync.task';
import { NotificationProcessor } from '../notification/notification.processor';
import { OHLCPruneTask } from '../ohlc/tasks/ohlc-prune.task';
import { OHLCSyncTask } from '../ohlc/tasks/ohlc-sync.task';
import { OptimizationProcessor } from '../optimization/processors/optimization.processor';
import { BacktestProcessor } from '../order/backtest/backtest.processor';
import { LiveReplayProcessor } from '../order/backtest/live-replay.processor';
import { PaperTradingProcessor } from '../order/paper-trading/paper-trading.processor';
import { LiquidationMonitorTask } from '../order/tasks/liquidation-monitor.task';
import { OrderSyncTask } from '../order/tasks/order-sync.task';
import { PositionMonitorTask } from '../order/tasks/position-monitor.task';
import { TradeExecutionTask } from '../order/tasks/trade-execution.task';
import { PipelineProcessor } from '../pipeline/processors/pipeline.processor';
import { BacktestOrchestrationProcessor } from '../tasks/backtest-orchestration.processor';
import { DriftDetectionProcessor } from '../tasks/drift-detection.processor';
import { MarketRegimeProcessor } from '../tasks/market-regime.processor';
import { PipelineOrchestrationProcessor } from '../tasks/pipeline-orchestration.processor';
import { StrategyEvaluationProcessor } from '../tasks/strategy-evaluation.processor';
import { UsersTaskService } from '../users/tasks/users.task';

const PROCESSOR_METADATA_KEY = 'bullmq:processor_metadata';

const PROCESSORS: Array<new (...args: any[]) => FailSafeWorkerHost> = [
  // order
  TradeExecutionTask,
  PositionMonitorTask,
  LiquidationMonitorTask,
  OrderSyncTask,
  BacktestProcessor,
  LiveReplayProcessor,
  PaperTradingProcessor,
  // tasks
  BacktestOrchestrationProcessor,
  MarketRegimeProcessor,
  PipelineOrchestrationProcessor,
  StrategyEvaluationProcessor,
  DriftDetectionProcessor,
  // pipeline
  PipelineProcessor,
  // exchange
  ExchangeSyncTask,
  ExchangeKeyHealthTask,
  // category
  CategorySyncTask,
  // notification
  NotificationProcessor,
  // ohlc
  OHLCPruneTask,
  OHLCSyncTask,
  // optimization
  OptimizationProcessor,
  // balance
  BalanceSyncTask,
  // algorithm
  PerformanceRankingTask,
  // coin-selection
  CoinSelectionHistoricalPriceTask,
  // coin
  CoinSyncTask,
  CoinSnapshotPruneTask,
  TickerPairSyncTask,
  // users
  UsersTaskService
];

const PROCESSOR_CASES = PROCESSORS.map((Cls) => [Cls.name, Cls] as const);

const readQueueName = (Cls: (typeof PROCESSORS)[number]): string | undefined => {
  const meta = Reflect.getMetadata(PROCESSOR_METADATA_KEY, Cls) as { name?: string } | undefined;
  return meta?.name;
};

describe('Processor contract', () => {
  it('covers all 27 processors', () => {
    expect(PROCESSORS).toHaveLength(27);
  });

  it.each(PROCESSOR_CASES)('%s extends FailSafeWorkerHost', (_name, Cls) => {
    expect(Cls.prototype instanceof FailSafeWorkerHost).toBe(true);
  });

  it.each(PROCESSOR_CASES)('%s has @Processor() decorator metadata with a queue name', (_name, Cls) => {
    const queueName = readQueueName(Cls);
    expect(typeof queueName).toBe('string');
    expect(queueName?.length ?? 0).toBeGreaterThan(0);
  });

  it('has no duplicate @Processor() queue names', () => {
    const namesByQueue = new Map<string, string[]>();
    for (const Cls of PROCESSORS) {
      const name = readQueueName(Cls);
      if (!name) continue;
      const owners = namesByQueue.get(name) ?? [];
      owners.push(Cls.name);
      namesByQueue.set(name, owners);
    }

    const duplicates = [...namesByQueue.entries()].filter(([, owners]) => owners.length > 1);
    expect(duplicates).toEqual([]);
  });
});
