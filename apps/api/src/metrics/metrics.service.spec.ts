import { MetricsService } from './metrics.service';
import { type BacktestMetricsService } from './services/backtest-metrics.service';
import { type InfraMetricsService } from './services/infra-metrics.service';
import { type StrategyMetricsService } from './services/strategy-metrics.service';
import { type TradingMetricsService } from './services/trading-metrics.service';

/**
 * Delegation map: facade method → [sub-service key, delegate method, sample args].
 * Exhaustive — every public method on MetricsService must appear here.
 */
const DELEGATION_MAP: [string, 'backtest' | 'trading' | 'strategy' | 'infra', string, unknown[]][] = [
  // Infra
  ['recordHttpRequest', 'infra', 'recordHttpRequest', ['GET', '/test', 200, 250]],
  ['setActiveConnections', 'infra', 'setActiveConnections', [5]],
  ['recordPriceUpdate', 'infra', 'recordPriceUpdate', ['coingecko', 2]],
  ['setPriceUpdateLag', 'infra', 'setPriceUpdateLag', ['coingecko', 1.5]],
  ['setQueueJobsWaiting', 'infra', 'setQueueJobsWaiting', ['orders', 7]],
  ['setQueueJobsActive', 'infra', 'setQueueJobsActive', ['orders', 3]],
  ['recordQueueJobCompleted', 'infra', 'recordQueueJobCompleted', ['orders']],
  ['recordQueueJobFailed', 'infra', 'recordQueueJobFailed', ['orders', 'timeout']],

  // Trading
  ['recordOrdersSynced', 'trading', 'recordOrdersSynced', ['binance', 'success', 3]],
  ['recordOrderSyncError', 'trading', 'recordOrderSyncError', ['binance', 'timeout']],
  ['startOrderSyncTimer', 'trading', 'startOrderSyncTimer', ['binance']],
  ['recordTradeExecuted', 'trading', 'recordTradeExecuted', ['coinbase', 'buy', 'BTC/USD']],
  ['startTradeExecutionTimer', 'trading', 'startTradeExecutionTimer', ['binance']],
  ['setExchangeConnections', 'trading', 'setExchangeConnections', ['binance', 2]],
  ['recordExchangeApiCall', 'trading', 'recordExchangeApiCall', ['binance', '/orders', true]],
  ['startExchangeApiTimer', 'trading', 'startExchangeApiTimer', ['binance', '/orders']],
  ['recordTradeCooldownBlock', 'trading', 'recordTradeCooldownBlock', ['buy', 'BTC/USD']],
  ['recordTradeCooldownClaim', 'trading', 'recordTradeCooldownClaim', ['sell', 'ETH/USD']],
  ['recordTradeCooldownCleared', 'trading', 'recordTradeCooldownCleared', ['expired']],
  ['recordSignalThrottleSuppressed', 'trading', 'recordSignalThrottleSuppressed', ['rsi', 5]],
  ['recordSignalThrottlePassed', 'trading', 'recordSignalThrottlePassed', ['rsi', 'buy']],
  ['recordRegimeGateBlock', 'trading', 'recordRegimeGateBlock', ['BEAR']],
  ['recordDrawdownGateBlock', 'trading', 'recordDrawdownGateBlock', []],
  ['recordDailyLossGateBlock', 'trading', 'recordDailyLossGateBlock', []],
  ['recordConcentrationGateBlock', 'trading', 'recordConcentrationGateBlock', []],
  ['recordLiveOrderPlaced', 'trading', 'recordLiveOrderPlaced', ['spot', 'buy']],

  // Backtest
  ['recordBacktestCompleted', 'backtest', 'recordBacktestCompleted', ['rsi', 'success']],
  ['startBacktestTimer', 'backtest', 'startBacktestTimer', ['rsi']],
  ['recordQuoteCurrencyFallback', 'backtest', 'recordQuoteCurrencyFallback', ['USD', 'USDT']],
  ['recordBacktestCreated', 'backtest', 'recordBacktestCreated', ['historical', 'rsi']],
  ['recordBacktestStarted', 'backtest', 'recordBacktestStarted', ['historical', 'rsi', false]],
  ['recordBacktestCancelled', 'backtest', 'recordBacktestCancelled', ['rsi']],
  ['incrementActiveBacktests', 'backtest', 'incrementActiveBacktests', ['historical']],
  ['decrementActiveBacktests', 'backtest', 'decrementActiveBacktests', ['historical']],
  ['startDataLoadTimer', 'backtest', 'startDataLoadTimer', ['postgres']],
  ['recordDataRecordsLoaded', 'backtest', 'recordDataRecordsLoaded', ['postgres', 1000]],
  ['recordTradeSimulated', 'backtest', 'recordTradeSimulated', ['rsi', 'buy', 'executed']],
  ['recordSlippage', 'backtest', 'recordSlippage', ['rsi', 'buy', 5]],
  ['recordAlgorithmExecution', 'backtest', 'recordAlgorithmExecution', ['rsi', 'success']],
  ['recordSignalGenerated', 'backtest', 'recordSignalGenerated', ['rsi', 'buy']],
  ['startPersistenceTimer', 'backtest', 'startPersistenceTimer', ['full']],
  ['recordRecordsPersisted', 'backtest', 'recordRecordsPersisted', ['trades', 50]],
  ['recordCoinResolution', 'backtest', 'recordCoinResolution', ['success']],
  ['recordInstrumentsResolved', 'backtest', 'recordInstrumentsResolved', ['direct', 10]],
  ['recordBacktestError', 'backtest', 'recordBacktestError', ['rsi', 'data_load_failed']],
  [
    'recordBacktestFinalMetrics',
    'backtest',
    'recordBacktestFinalMetrics',
    ['rsi', { totalReturn: 0.1, sharpeRatio: 1.5, maxDrawdown: 0.2, tradeCount: 50 }]
  ],
  ['recordCheckpointSaved', 'backtest', 'recordCheckpointSaved', ['rsi']],
  ['recordCheckpointResumed', 'backtest', 'recordCheckpointResumed', ['rsi']],
  ['recordCheckpointOrphansCleaned', 'backtest', 'recordCheckpointOrphansCleaned', ['trades', 3]],
  ['setCheckpointProgress', 'backtest', 'setCheckpointProgress', ['bt-1', 'rsi', 75]],
  ['clearCheckpointProgress', 'backtest', 'clearCheckpointProgress', ['bt-1', 'rsi']],

  // Strategy
  ['setStrategyDeploymentsActive', 'strategy', 'setStrategyDeploymentsActive', ['trend', 'live', 2]],
  ['recordStrategySignal', 'strategy', 'recordStrategySignal', ['rsi', 'buy']],
  ['recordStrategyHeartbeat', 'strategy', 'recordStrategyHeartbeat', ['rsi', 'success']],
  ['setStrategyHeartbeatAge', 'strategy', 'setStrategyHeartbeatAge', ['rsi', 'shadow', 120]],
  ['setStrategyHeartbeatFailures', 'strategy', 'setStrategyHeartbeatFailures', ['rsi', 3]],
  ['setStrategyHealthScore', 'strategy', 'setStrategyHealthScore', ['rsi', 'shadow', 85]],
  ['setPortfolioTotalValue', 'strategy', 'setPortfolioTotalValue', ['user-1', 10000]],
  ['setPortfolioAssetsCount', 'strategy', 'setPortfolioAssetsCount', ['user-1', 'binance', 5]],
  ['calculateAndSetHealthScore', 'strategy', 'calculateAndSetHealthScore', ['rsi', 'shadow', 900, 3, 300]]
];

const mockMethods = (methods: string[]) =>
  Object.fromEntries(methods.map((m) => [m, jest.fn()])) as Record<string, jest.Mock>;

const buildService = () => {
  const backtest = mockMethods(
    DELEGATION_MAP.filter(([, svc]) => svc === 'backtest').map(([, , m]) => m)
  ) as unknown as BacktestMetricsService;

  const trading = mockMethods(
    DELEGATION_MAP.filter(([, svc]) => svc === 'trading').map(([, , m]) => m)
  ) as unknown as TradingMetricsService;

  const strategy = mockMethods(
    DELEGATION_MAP.filter(([, svc]) => svc === 'strategy').map(([, , m]) => m)
  ) as unknown as StrategyMetricsService;

  const infra = mockMethods(
    DELEGATION_MAP.filter(([, svc]) => svc === 'infra').map(([, , m]) => m)
  ) as unknown as InfraMetricsService;

  const service = new MetricsService(backtest, trading, strategy, infra);
  return { service, backtest, trading, strategy, infra };
};

describe('MetricsService (facade)', () => {
  it.each(DELEGATION_MAP)('%s delegates to %s.%s', (facadeMethod, subService, delegateMethod, args) => {
    const deps = buildService();
    const service = deps.service;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)[facadeMethod](...args);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = (deps[subService] as any)[delegateMethod] as jest.Mock;
    expect(mock).toHaveBeenCalledWith(...args);
  });

  it('covers every public method on MetricsService', () => {
    const facadeMethods = Object.getOwnPropertyNames(MetricsService.prototype).filter((m) => m !== 'constructor');
    const testedMethods = DELEGATION_MAP.map(([m]) => m);

    expect(testedMethods.sort()).toEqual(facadeMethods.sort());
  });

  it('has no duplicate delegation entries', () => {
    const seen = new Set<string>();
    for (const [method] of DELEGATION_MAP) {
      expect(seen.has(method)).toBe(false);
      seen.add(method);
    }
  });
});
