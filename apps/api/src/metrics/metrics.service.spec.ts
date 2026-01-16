import { MetricsService } from './metrics.service';

const createCounterMock = () => ({ inc: jest.fn() }) as any;
const createGaugeMock = () => ({ set: jest.fn() }) as any;
const createHistogramMock = () =>
  ({
    observe: jest.fn(),
    startTimer: jest.fn()
  }) as any;

const buildService = () => {
  const mocks = {
    httpRequestDuration: createHistogramMock(),
    httpRequestsTotal: createCounterMock(),
    httpConnectionsActive: createGaugeMock(),

    ordersSyncedTotal: createCounterMock(),
    ordersSyncErrorsTotal: createCounterMock(),
    orderSyncDuration: createHistogramMock(),

    tradesExecutedTotal: createCounterMock(),
    tradeExecutionDuration: createHistogramMock(),

    exchangeConnections: createGaugeMock(),
    exchangeApiCallsTotal: createCounterMock(),
    exchangeApiLatency: createHistogramMock(),

    priceUpdatesTotal: createCounterMock(),
    priceUpdateLag: createGaugeMock(),

    backtestsCompletedTotal: createCounterMock(),
    backtestDuration: createHistogramMock(),
    quoteCurrencyFallbackTotal: createCounterMock(),

    queueJobsWaiting: createGaugeMock(),
    queueJobsActive: createGaugeMock(),
    queueJobsCompletedTotal: createCounterMock(),
    queueJobsFailedTotal: createCounterMock(),

    portfolioTotalValue: createGaugeMock(),
    portfolioAssetsCount: createGaugeMock(),

    strategyDeploymentsActive: createGaugeMock(),
    strategySignalsTotal: createCounterMock(),

    strategyHeartbeatAge: createGaugeMock(),
    strategyHeartbeatTotal: createCounterMock(),
    strategyHeartbeatFailures: createGaugeMock(),
    strategyHealthScore: createGaugeMock()
  };

  const service = new MetricsService(
    mocks.httpRequestDuration,
    mocks.httpRequestsTotal,
    mocks.httpConnectionsActive,
    mocks.ordersSyncedTotal,
    mocks.ordersSyncErrorsTotal,
    mocks.orderSyncDuration,
    mocks.tradesExecutedTotal,
    mocks.tradeExecutionDuration,
    mocks.exchangeConnections,
    mocks.exchangeApiCallsTotal,
    mocks.exchangeApiLatency,
    mocks.priceUpdatesTotal,
    mocks.priceUpdateLag,
    mocks.backtestsCompletedTotal,
    mocks.backtestDuration,
    mocks.quoteCurrencyFallbackTotal,
    mocks.queueJobsWaiting,
    mocks.queueJobsActive,
    mocks.queueJobsCompletedTotal,
    mocks.queueJobsFailedTotal,
    mocks.portfolioTotalValue,
    mocks.portfolioAssetsCount,
    mocks.strategyDeploymentsActive,
    mocks.strategySignalsTotal,
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
