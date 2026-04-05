import { BacktestMetricsService } from './backtest-metrics.service';

const createCounterMock = () => ({ inc: jest.fn() }) as any;
const createGaugeMock = () => ({ set: jest.fn(), inc: jest.fn(), dec: jest.fn() }) as any;
const createHistogramMock = () => ({ observe: jest.fn(), startTimer: jest.fn() }) as any;

const buildService = () => {
  const mocks = {
    backtestsCompletedTotal: createCounterMock(),
    backtestDuration: createHistogramMock(),
    quoteCurrencyFallbackTotal: createCounterMock(),
    backtestCreatedTotal: createCounterMock(),
    backtestStartedTotal: createCounterMock(),
    backtestCancelledTotal: createCounterMock(),
    backtestActiveCount: createGaugeMock(),
    backtestDataLoadDuration: createHistogramMock(),
    backtestDataRecordsLoaded: createCounterMock(),
    backtestTradesSimulated: createCounterMock(),
    backtestSlippageBps: createHistogramMock(),
    backtestAlgorithmExecutions: createCounterMock(),
    backtestSignalsGenerated: createCounterMock(),
    backtestPersistenceDuration: createHistogramMock(),
    backtestRecordsPersisted: createCounterMock(),
    backtestCoinResolution: createCounterMock(),
    backtestInstrumentsResolved: createCounterMock(),
    backtestErrors: createCounterMock(),
    backtestTotalReturn: createHistogramMock(),
    backtestSharpeRatio: createHistogramMock(),
    backtestMaxDrawdown: createHistogramMock(),
    backtestTradeCount: createHistogramMock(),
    backtestCheckpointsSavedTotal: createCounterMock(),
    backtestCheckpointsResumedTotal: createCounterMock(),
    backtestCheckpointOrphansCleanedTotal: createCounterMock(),
    backtestCheckpointProgress: createGaugeMock()
  };

  const service = new BacktestMetricsService(
    mocks.backtestsCompletedTotal,
    mocks.backtestDuration,
    mocks.quoteCurrencyFallbackTotal,
    mocks.backtestCreatedTotal,
    mocks.backtestStartedTotal,
    mocks.backtestCancelledTotal,
    mocks.backtestActiveCount,
    mocks.backtestDataLoadDuration,
    mocks.backtestDataRecordsLoaded,
    mocks.backtestTradesSimulated,
    mocks.backtestSlippageBps,
    mocks.backtestAlgorithmExecutions,
    mocks.backtestSignalsGenerated,
    mocks.backtestPersistenceDuration,
    mocks.backtestRecordsPersisted,
    mocks.backtestCoinResolution,
    mocks.backtestInstrumentsResolved,
    mocks.backtestErrors,
    mocks.backtestTotalReturn,
    mocks.backtestSharpeRatio,
    mocks.backtestMaxDrawdown,
    mocks.backtestTradeCount,
    mocks.backtestCheckpointsSavedTotal,
    mocks.backtestCheckpointsResumedTotal,
    mocks.backtestCheckpointOrphansCleanedTotal,
    mocks.backtestCheckpointProgress
  );

  return { service, mocks };
};

describe('BacktestMetricsService', () => {
  it('coerces resumed boolean to string label', () => {
    const { service, mocks } = buildService();

    service.recordBacktestStarted('historical', 'rsi', true);
    expect(mocks.backtestStartedTotal.inc).toHaveBeenCalledWith({
      type: 'historical',
      strategy: 'rsi',
      resumed: 'true'
    });

    service.recordBacktestStarted('historical', 'rsi', false);
    expect(mocks.backtestStartedTotal.inc).toHaveBeenCalledWith({
      type: 'historical',
      strategy: 'rsi',
      resumed: 'false'
    });
  });

  it('converts final metrics to percentages and raw values', () => {
    const { service, mocks } = buildService();

    service.recordBacktestFinalMetrics('rsi', {
      totalReturn: 0.15,
      sharpeRatio: 1.2,
      maxDrawdown: 0.1,
      tradeCount: 42
    });

    expect(mocks.backtestTotalReturn.observe).toHaveBeenCalledWith({ strategy: 'rsi' }, 15);
    expect(mocks.backtestSharpeRatio.observe).toHaveBeenCalledWith({ strategy: 'rsi' }, 1.2);
    expect(mocks.backtestMaxDrawdown.observe).toHaveBeenCalledWith({ strategy: 'rsi' }, 10);
    expect(mocks.backtestTradeCount.observe).toHaveBeenCalledWith({ strategy: 'rsi' }, 42);
  });

  describe('count > 0 guard clauses', () => {
    it.each([
      ['recordRecordsPersisted', 'backtestRecordsPersisted', ['trades', 5], { entity_type: 'trades' }, 5],
      ['recordInstrumentsResolved', 'backtestInstrumentsResolved', ['direct', 3], { method: 'direct' }, 3],
      [
        'recordCheckpointOrphansCleaned',
        'backtestCheckpointOrphansCleanedTotal',
        ['trades', 2],
        { entity_type: 'trades' },
        2
      ]
    ] as const)('%s increments when count > 0', (method, mockKey, args, expectedLabels, expectedCount) => {
      const { service, mocks } = buildService();

      (service as any)[method](...args);
      expect((mocks as any)[mockKey].inc).toHaveBeenCalledWith(expectedLabels, expectedCount);
    });

    it.each([
      ['recordRecordsPersisted', 'backtestRecordsPersisted', ['trades', 0]],
      ['recordInstrumentsResolved', 'backtestInstrumentsResolved', ['direct', 0]],
      ['recordCheckpointOrphansCleaned', 'backtestCheckpointOrphansCleanedTotal', ['trades', 0]]
    ] as const)('%s skips when count is 0', (method, mockKey, args) => {
      const { service, mocks } = buildService();

      (service as any)[method](...args);
      expect((mocks as any)[mockKey].inc).not.toHaveBeenCalled();
    });
  });

  it('sets and clears checkpoint progress', () => {
    const { service, mocks } = buildService();

    service.setCheckpointProgress('bt-1', 'rsi', 75);
    expect(mocks.backtestCheckpointProgress.set).toHaveBeenCalledWith({ backtest_id: 'bt-1', strategy: 'rsi' }, 75);

    service.clearCheckpointProgress('bt-1', 'rsi');
    expect(mocks.backtestCheckpointProgress.set).toHaveBeenCalledWith({ backtest_id: 'bt-1', strategy: 'rsi' }, 0);
  });
});
