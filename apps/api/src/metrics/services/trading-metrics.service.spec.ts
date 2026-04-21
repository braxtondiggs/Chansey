import { TradingMetricsService } from './trading-metrics.service';

const createCounterMock = () => ({ inc: jest.fn() }) as any;
const createGaugeMock = () => ({ set: jest.fn() }) as any;
const createHistogramMock = () => ({ observe: jest.fn(), startTimer: jest.fn() }) as any;

const buildService = () => {
  const mocks = {
    ordersSyncedTotal: createCounterMock(),
    ordersSyncErrorsTotal: createCounterMock(),
    orderSyncDuration: createHistogramMock(),
    tradesExecutedTotal: createCounterMock(),
    tradeExecutionDuration: createHistogramMock(),
    exchangeConnections: createGaugeMock(),
    exchangeApiCallsTotal: createCounterMock(),
    exchangeApiLatency: createHistogramMock(),
    tradeCooldownBlocksTotal: createCounterMock(),
    tradeCooldownClaimsTotal: createCounterMock(),
    tradeCooldownClearedTotal: createCounterMock(),
    signalThrottleSuppressedTotal: createCounterMock(),
    signalThrottlePassedTotal: createCounterMock(),
    regimeGateBlocksTotal: createCounterMock(),
    drawdownGateBlocksTotal: createCounterMock(),
    dailyLossGateBlocksTotal: createCounterMock(),
    concentrationGateBlocksTotal: createCounterMock(),
    liveOrdersPlacedTotal: createCounterMock(),
    listingTrackerUnmatchedTotal: createCounterMock()
  };

  const service = new TradingMetricsService(
    mocks.ordersSyncedTotal,
    mocks.ordersSyncErrorsTotal,
    mocks.orderSyncDuration,
    mocks.tradesExecutedTotal,
    mocks.tradeExecutionDuration,
    mocks.exchangeConnections,
    mocks.exchangeApiCallsTotal,
    mocks.exchangeApiLatency,
    mocks.tradeCooldownBlocksTotal,
    mocks.tradeCooldownClaimsTotal,
    mocks.tradeCooldownClearedTotal,
    mocks.signalThrottleSuppressedTotal,
    mocks.signalThrottlePassedTotal,
    mocks.regimeGateBlocksTotal,
    mocks.drawdownGateBlocksTotal,
    mocks.dailyLossGateBlocksTotal,
    mocks.concentrationGateBlocksTotal,
    mocks.liveOrdersPlacedTotal,
    mocks.listingTrackerUnmatchedTotal
  );

  return { service, mocks };
};

describe('TradingMetricsService', () => {
  it('records order sync and trade metrics', () => {
    const { service, mocks } = buildService();
    const end = jest.fn();
    mocks.orderSyncDuration.startTimer.mockReturnValue(end);

    service.startOrderSyncTimer('binance')();
    expect(mocks.orderSyncDuration.startTimer).toHaveBeenCalledWith({ exchange: 'binance' });
    expect(end).toHaveBeenCalled();

    service.recordOrdersSynced('binance', 'success', 3);
    expect(mocks.ordersSyncedTotal.inc).toHaveBeenCalledWith({ exchange: 'binance', status: 'success' }, 3);

    service.recordOrderSyncError('binance', 'network');
    expect(mocks.ordersSyncErrorsTotal.inc).toHaveBeenCalledWith({ exchange: 'binance', error_type: 'network' });

    service.recordTradeExecuted('coinbase', 'buy', 'BTC/USD');
    expect(mocks.tradesExecutedTotal.inc).toHaveBeenCalledWith({
      exchange: 'coinbase',
      side: 'buy',
      symbol: 'BTC/USD'
    });
  });

  it('records exchange API metrics', () => {
    const { service, mocks } = buildService();
    const apiEnd = jest.fn();
    mocks.exchangeApiLatency.startTimer.mockReturnValue(apiEnd);

    service.setExchangeConnections('coinbase', 4);
    expect(mocks.exchangeConnections.set).toHaveBeenCalledWith({ exchange: 'coinbase' }, 4);

    service.recordExchangeApiCall('coinbase', '/orders', true);
    expect(mocks.exchangeApiCallsTotal.inc).toHaveBeenCalledWith({
      exchange: 'coinbase',
      endpoint: '/orders',
      success: 'true'
    });

    service.startExchangeApiTimer('coinbase', '/orders')();
    expect(apiEnd).toHaveBeenCalled();
  });

  it('records trade execution timer', () => {
    const { service, mocks } = buildService();
    const end = jest.fn();
    mocks.tradeExecutionDuration.startTimer.mockReturnValue(end);

    service.startTradeExecutionTimer('binance')();
    expect(mocks.tradeExecutionDuration.startTimer).toHaveBeenCalledWith({ exchange: 'binance' });
    expect(end).toHaveBeenCalled();
  });

  it('records live trading gate metrics', () => {
    const { service, mocks } = buildService();

    service.recordTradeCooldownBlock('buy', 'BTC');
    expect(mocks.tradeCooldownBlocksTotal.inc).toHaveBeenCalledWith({ direction: 'buy', symbol: 'BTC' });

    service.recordTradeCooldownClaim('sell', 'ETH');
    expect(mocks.tradeCooldownClaimsTotal.inc).toHaveBeenCalledWith({ direction: 'sell', symbol: 'ETH' });

    service.recordTradeCooldownCleared('expired');
    expect(mocks.tradeCooldownClearedTotal.inc).toHaveBeenCalledWith({ reason: 'expired' });

    service.recordRegimeGateBlock('BEAR');
    expect(mocks.regimeGateBlocksTotal.inc).toHaveBeenCalledWith({ regime: 'BEAR' });

    service.recordDrawdownGateBlock();
    expect(mocks.drawdownGateBlocksTotal.inc).toHaveBeenCalled();

    service.recordDailyLossGateBlock();
    expect(mocks.dailyLossGateBlocksTotal.inc).toHaveBeenCalled();

    service.recordConcentrationGateBlock();
    expect(mocks.concentrationGateBlocksTotal.inc).toHaveBeenCalled();

    service.recordLiveOrderPlaced('spot', 'buy');
    expect(mocks.liveOrdersPlacedTotal.inc).toHaveBeenCalledWith({ market_type: 'spot', side: 'buy' });
  });

  it('records signal throttle metrics', () => {
    const { service, mocks } = buildService();

    service.recordSignalThrottleSuppressed('rsi-momentum-001', 5);
    expect(mocks.signalThrottleSuppressedTotal.inc).toHaveBeenCalledWith({ strategy: 'rsi-momentum-001' }, 5);

    service.recordSignalThrottlePassed('confluence-001', 'buy');
    expect(mocks.signalThrottlePassedTotal.inc).toHaveBeenCalledWith({ strategy: 'confluence-001', action: 'buy' });
  });

  it('records listing tracker unmatched symbols by exchange', () => {
    const { service, mocks } = buildService();

    service.recordListingTrackerUnmatched('kraken');
    expect(mocks.listingTrackerUnmatchedTotal.inc).toHaveBeenCalledWith({ exchange_slug: 'kraken' });
  });
});
