import { MetricsService } from './metrics.service';

const createCounterMock = () => ({ inc: jest.fn() }) as any;
const createGaugeMock = () => ({ set: jest.fn(), inc: jest.fn(), dec: jest.fn() }) as any;
const createHistogramMock = () =>
  ({
    observe: jest.fn(),
    startTimer: jest.fn()
  }) as any;

const buildService = () => {
  const mocks = {
    // HTTP Metrics
    httpRequestDuration: createHistogramMock(),
    httpRequestsTotal: createCounterMock(),
    httpConnectionsActive: createGaugeMock(),

    // Order Metrics
    ordersSyncedTotal: createCounterMock(),
    ordersSyncErrorsTotal: createCounterMock(),
    orderSyncDuration: createHistogramMock(),

    // Trade Metrics
    tradesExecutedTotal: createCounterMock(),
    tradeExecutionDuration: createHistogramMock(),

    // Exchange Metrics
    exchangeConnections: createGaugeMock(),
    exchangeApiCallsTotal: createCounterMock(),
    exchangeApiLatency: createHistogramMock(),

    // Price Metrics
    priceUpdatesTotal: createCounterMock(),
    priceUpdateLag: createGaugeMock(),

    // Backtest Metrics
    backtestsCompletedTotal: createCounterMock(),
    backtestDuration: createHistogramMock(),
    quoteCurrencyFallbackTotal: createCounterMock(),

    // Backtest Lifecycle Metrics
    backtestCreatedTotal: createCounterMock(),
    backtestStartedTotal: createCounterMock(),
    backtestCancelledTotal: createCounterMock(),
    backtestActiveCount: createGaugeMock(),

    // Backtest Data Loading Metrics
    backtestDataLoadDuration: createHistogramMock(),
    backtestDataRecordsLoaded: createCounterMock(),

    // Backtest Trade Execution Metrics
    backtestTradesSimulated: createCounterMock(),
    backtestSlippageBps: createHistogramMock(),

    // Backtest Algorithm Execution Metrics
    backtestAlgorithmExecutions: createCounterMock(),
    backtestSignalsGenerated: createCounterMock(),

    // Backtest Result Persistence Metrics
    backtestPersistenceDuration: createHistogramMock(),
    backtestRecordsPersisted: createCounterMock(),

    // Backtest Resolution Metrics
    backtestCoinResolution: createCounterMock(),
    backtestInstrumentsResolved: createCounterMock(),

    // Backtest Error Metrics
    backtestErrors: createCounterMock(),

    // Backtest Final Results Metrics
    backtestTotalReturn: createHistogramMock(),
    backtestSharpeRatio: createHistogramMock(),
    backtestMaxDrawdown: createHistogramMock(),
    backtestTradeCount: createHistogramMock(),

    // Backtest Checkpoint Metrics
    backtestCheckpointsSavedTotal: createCounterMock(),
    backtestCheckpointsResumedTotal: createCounterMock(),
    backtestCheckpointOrphansCleanedTotal: createCounterMock(),
    backtestCheckpointProgress: createGaugeMock(),

    // Queue Metrics
    queueJobsWaiting: createGaugeMock(),
    queueJobsActive: createGaugeMock(),
    queueJobsCompletedTotal: createCounterMock(),
    queueJobsFailedTotal: createCounterMock(),

    // Portfolio Metrics
    portfolioTotalValue: createGaugeMock(),
    portfolioAssetsCount: createGaugeMock(),

    // Strategy Metrics
    strategyDeploymentsActive: createGaugeMock(),
    strategySignalsTotal: createCounterMock(),

    // Strategy Heartbeat Metrics
    strategyHeartbeatAge: createGaugeMock(),
    strategyHeartbeatTotal: createCounterMock(),
    strategyHeartbeatFailures: createGaugeMock(),
    strategyHealthScore: createGaugeMock()
  };

  const service = new MetricsService(
    // HTTP Metrics
    mocks.httpRequestDuration,
    mocks.httpRequestsTotal,
    mocks.httpConnectionsActive,
    // Order Metrics
    mocks.ordersSyncedTotal,
    mocks.ordersSyncErrorsTotal,
    mocks.orderSyncDuration,
    // Trade Metrics
    mocks.tradesExecutedTotal,
    mocks.tradeExecutionDuration,
    // Exchange Metrics
    mocks.exchangeConnections,
    mocks.exchangeApiCallsTotal,
    mocks.exchangeApiLatency,
    // Price Metrics
    mocks.priceUpdatesTotal,
    mocks.priceUpdateLag,
    // Backtest Metrics
    mocks.backtestsCompletedTotal,
    mocks.backtestDuration,
    mocks.quoteCurrencyFallbackTotal,
    // Backtest Lifecycle Metrics
    mocks.backtestCreatedTotal,
    mocks.backtestStartedTotal,
    mocks.backtestCancelledTotal,
    mocks.backtestActiveCount,
    // Backtest Data Loading Metrics
    mocks.backtestDataLoadDuration,
    mocks.backtestDataRecordsLoaded,
    // Backtest Trade Execution Metrics
    mocks.backtestTradesSimulated,
    mocks.backtestSlippageBps,
    // Backtest Algorithm Execution Metrics
    mocks.backtestAlgorithmExecutions,
    mocks.backtestSignalsGenerated,
    // Backtest Result Persistence Metrics
    mocks.backtestPersistenceDuration,
    mocks.backtestRecordsPersisted,
    // Backtest Resolution Metrics
    mocks.backtestCoinResolution,
    mocks.backtestInstrumentsResolved,
    // Backtest Error Metrics
    mocks.backtestErrors,
    // Backtest Final Results Metrics
    mocks.backtestTotalReturn,
    mocks.backtestSharpeRatio,
    mocks.backtestMaxDrawdown,
    mocks.backtestTradeCount,
    // Backtest Checkpoint Metrics
    mocks.backtestCheckpointsSavedTotal,
    mocks.backtestCheckpointsResumedTotal,
    mocks.backtestCheckpointOrphansCleanedTotal,
    mocks.backtestCheckpointProgress,
    // Queue Metrics
    mocks.queueJobsWaiting,
    mocks.queueJobsActive,
    mocks.queueJobsCompletedTotal,
    mocks.queueJobsFailedTotal,
    // Portfolio Metrics
    mocks.portfolioTotalValue,
    mocks.portfolioAssetsCount,
    // Strategy Metrics
    mocks.strategyDeploymentsActive,
    mocks.strategySignalsTotal,
    // Strategy Heartbeat Metrics
    mocks.strategyHeartbeatAge,
    mocks.strategyHeartbeatTotal,
    mocks.strategyHeartbeatFailures,
    mocks.strategyHealthScore
  );

  return { service, mocks };
};

describe('MetricsService', () => {
  it('records HTTP requests and durations', () => {
    const { service, mocks } = buildService();

    service.recordHttpRequest('GET', '/test', 200, 250);

    expect(mocks.httpRequestDuration.observe).toHaveBeenCalledWith(
      { method: 'GET', route: '/test', status_code: '200' },
      0.25
    );
    expect(mocks.httpRequestsTotal.inc).toHaveBeenCalledWith({ method: 'GET', route: '/test', status_code: '200' });
  });

  it('handles order sync timers and counters', () => {
    const { service, mocks } = buildService();
    const end = jest.fn();
    mocks.orderSyncDuration.startTimer.mockReturnValue(end);

    const timer = service.startOrderSyncTimer('binance');
    timer();

    expect(mocks.orderSyncDuration.startTimer).toHaveBeenCalledWith({ exchange: 'binance' });
    expect(end).toHaveBeenCalled();

    service.recordOrdersSynced('binance', 'success', 3);
    expect(mocks.ordersSyncedTotal.inc).toHaveBeenCalledWith({ exchange: 'binance', status: 'success' }, 3);

    service.recordOrderSyncError('binance', 'network');
    expect(mocks.ordersSyncErrorsTotal.inc).toHaveBeenCalledWith({ exchange: 'binance', error_type: 'network' });
  });

  it('records trades and exchanges metrics', () => {
    const { service, mocks } = buildService();
    const tradeEnd = jest.fn();
    const apiEnd = jest.fn();
    mocks.tradeExecutionDuration.startTimer.mockReturnValue(tradeEnd);
    mocks.exchangeApiLatency.startTimer.mockReturnValue(apiEnd);

    service.recordTradeExecuted('coinbase', 'buy', 'BTC/USD');
    service.recordExchangeApiCall('coinbase', '/orders', true);
    service.setExchangeConnections('coinbase', 4);
    service.startTradeExecutionTimer('coinbase')();
    service.startExchangeApiTimer('coinbase', '/orders')();

    expect(mocks.tradesExecutedTotal.inc).toHaveBeenCalledWith({
      exchange: 'coinbase',
      side: 'buy',
      symbol: 'BTC/USD'
    });
    expect(mocks.exchangeApiCallsTotal.inc).toHaveBeenCalledWith({
      exchange: 'coinbase',
      endpoint: '/orders',
      success: 'true'
    });
    expect(mocks.exchangeConnections.set).toHaveBeenCalledWith({ exchange: 'coinbase' }, 4);
    expect(tradeEnd).toHaveBeenCalled();
    expect(apiEnd).toHaveBeenCalled();
  });

  it('records price, backtest, and queue metrics', () => {
    const { service, mocks } = buildService();
    const backtestEnd = jest.fn();
    mocks.backtestDuration.startTimer.mockReturnValue(backtestEnd);

    service.recordPriceUpdate('coingecko', 2);
    service.setPriceUpdateLag('coingecko', 5);
    service.recordBacktestCompleted('mean-reversion', 'success');
    service.startBacktestTimer('mean-reversion')();
    service.recordQuoteCurrencyFallback('USDT', 'USDC');
    service.setQueueJobsWaiting('orders', 7);
    service.setQueueJobsActive('orders', 3);
    service.recordQueueJobCompleted('orders');
    service.recordQueueJobFailed('orders', 'timeout');

    expect(mocks.priceUpdatesTotal.inc).toHaveBeenCalledWith({ source: 'coingecko' }, 2);
    expect(mocks.priceUpdateLag.set).toHaveBeenCalledWith({ source: 'coingecko' }, 5);
    expect(mocks.backtestsCompletedTotal.inc).toHaveBeenCalledWith({ strategy: 'mean-reversion', status: 'success' });
    expect(backtestEnd).toHaveBeenCalled();
    expect(mocks.quoteCurrencyFallbackTotal.inc).toHaveBeenCalledWith({ preferred: 'USDT', actual: 'USDC' });
    expect(mocks.queueJobsWaiting.set).toHaveBeenCalledWith({ queue: 'orders' }, 7);
    expect(mocks.queueJobsActive.set).toHaveBeenCalledWith({ queue: 'orders' }, 3);
    expect(mocks.queueJobsCompletedTotal.inc).toHaveBeenCalledWith({ queue: 'orders' });
    expect(mocks.queueJobsFailedTotal.inc).toHaveBeenCalledWith({ queue: 'orders', error_type: 'timeout' });
  });

  it('records portfolio and strategy deployment metrics', () => {
    const { service, mocks } = buildService();

    service.setPortfolioTotalValue('user-1', 12000);
    service.setPortfolioAssetsCount('user-1', 'binance', 5);
    service.setStrategyDeploymentsActive('trend', 'live', 2);
    service.recordStrategySignal('trend', 'buy');

    expect(mocks.portfolioTotalValue.set).toHaveBeenCalledWith({ user_id: 'user-1' }, 12000);
    expect(mocks.portfolioAssetsCount.set).toHaveBeenCalledWith({ user_id: 'user-1', exchange: 'binance' }, 5);
    expect(mocks.strategyDeploymentsActive.set).toHaveBeenCalledWith({ strategy: 'trend', status: 'live' }, 2);
    expect(mocks.strategySignalsTotal.inc).toHaveBeenCalledWith({ strategy: 'trend', signal_type: 'buy' });
  });

  it('records strategy heartbeat metrics and clamps health score', () => {
    const { service, mocks } = buildService();

    service.recordStrategyHeartbeat('scalper', 'success');
    service.setStrategyHeartbeatAge('scalper', 'shadow', 42);
    service.setStrategyHeartbeatFailures('scalper', 3);
    service.setStrategyHealthScore('scalper', 'shadow', 150);
    service.setStrategyHealthScore('scalper', 'shadow', -10);

    expect(mocks.strategyHeartbeatTotal.inc).toHaveBeenCalledWith({ strategy: 'scalper', status: 'success' });
    expect(mocks.strategyHeartbeatAge.set).toHaveBeenCalledWith({ strategy: 'scalper', shadow_status: 'shadow' }, 42);
    expect(mocks.strategyHeartbeatFailures.set).toHaveBeenCalledWith({ strategy: 'scalper' }, 3);
    expect(mocks.strategyHealthScore.set).toHaveBeenCalledWith({ strategy: 'scalper', shadow_status: 'shadow' }, 100);
    expect(mocks.strategyHealthScore.set).toHaveBeenCalledWith({ strategy: 'scalper', shadow_status: 'shadow' }, 0);
  });

  it('calculates health score from heartbeat metrics', () => {
    const { service } = buildService();
    const clampSpy = jest.spyOn(service, 'setStrategyHealthScore').mockImplementation(jest.fn());

    service.calculateAndSetHealthScore('scalper', 'shadow', 900, 3, 300);

    expect(clampSpy).toHaveBeenCalledWith('scalper', 'shadow', 15);
  });
});
