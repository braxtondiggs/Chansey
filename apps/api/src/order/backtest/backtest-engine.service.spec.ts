import { CompositeRegimeType, MarketRegimeType } from '@chansey/api-interfaces';

import { BacktestEngine } from './backtest-engine.service';
import { ReplaySpeed } from './backtest-pacing.interface';
import {
  BacktestBarProcessor,
  BacktestLoopRunner,
  BacktestSignalTradeService,
  CheckpointService,
  CompositeRegimeService,
  ExitSignalProcessorService,
  FeeCalculatorService,
  ForcedExitService,
  MetricsAccumulatorService,
  MetricsCalculatorService,
  OpportunitySellService,
  OptimizationCoreService,
  OptimizationIndicatorPrecomputeService,
  type Portfolio,
  PortfolioStateService,
  PositionManagerService,
  PriceWindowService,
  SignalFilterChainService,
  SignalThrottleService,
  SlippageContextService,
  SlippageService,
  TradeExecutorService
} from './shared';

import { SignalType } from '../../algorithm/interfaces';
import { AlgorithmNotRegisteredException } from '../../common/exceptions';
import { DrawdownCalculator } from '../../common/metrics/drawdown.calculator';
import { SharpeRatioCalculator } from '../../common/metrics/sharpe-ratio.calculator';
import { RegimeGateService } from '../../market-regime/regime-gate.service';
import { VolatilityCalculator } from '../../market-regime/volatility.calculator';
import { OHLCCandle } from '../../ohlc/ohlc-candle.entity';
import { PositionAnalysisService } from '../services/position-analysis.service';

const positionAnalysis = new PositionAnalysisService();

// Create shared service instances for tests
const sharpeCalculator = new SharpeRatioCalculator();
const drawdownCalculator = new DrawdownCalculator();
const slippageService = new SlippageService();
const feeCalculator = new FeeCalculatorService();
const positionManager = new PositionManagerService();
const metricsCalculator = new MetricsCalculatorService(sharpeCalculator, drawdownCalculator);
const portfolioState = new PortfolioStateService();
const signalThrottle = new SignalThrottleService();
const regimeGateService = new RegimeGateService();
const volatilityCalculator = new VolatilityCalculator();
const signalFilterChain = new SignalFilterChainService();
const priceWindowService = new PriceWindowService();
const tradeExecutor = new TradeExecutorService(slippageService, feeCalculator, portfolioState);
const checkpointService = new CheckpointService();
const exitSignalProcessor = new ExitSignalProcessorService();
const compositeRegimeService = new CompositeRegimeService(regimeGateService, volatilityCalculator, signalFilterChain);
const slippageContextService = new SlippageContextService();
const metricsAccumulatorService = new MetricsAccumulatorService(metricsCalculator, checkpointService);
const opportunitySellService = new OpportunitySellService(feeCalculator, positionAnalysis);
const forcedExitService = new ForcedExitService(positionManager, portfolioState);
const signalTradeService = new BacktestSignalTradeService(
  tradeExecutor,
  slippageContextService,
  opportunitySellService
);

/**
 * Create an OptimizationCoreService instance for tests.
 * Accepts an optional algorithmRegistry override; defaults to a stub.
 */
const createOptimizationCore = (algorithmRegistry: any = {}, ohlcService: any = {}) =>
  new OptimizationCoreService(
    portfolioState,
    metricsCalculator,
    algorithmRegistry,
    priceWindowService,
    exitSignalProcessor,
    compositeRegimeService,
    slippageContextService,
    signalThrottle,
    new OptimizationIndicatorPrecomputeService(algorithmRegistry),
    tradeExecutor,
    ohlcService
  );

const createTestEngine = (
  algorithmRegistry: any,
  ohlcService: any,
  overrides: {
    backtestStream?: any;
    marketDataReader?: any;
    quoteCurrencyResolver?: any;
    coinListingEventService?: any;
    optimizationCore?: any;
  } = {}
) => {
  const backtestStream = overrides.backtestStream ?? ({ publishMetric: jest.fn(), publishStatus: jest.fn() } as any);
  const marketDataReader =
    overrides.marketDataReader ?? ({ hasStorageLocation: jest.fn().mockReturnValue(false) } as any);
  const quoteCurrencyResolver =
    overrides.quoteCurrencyResolver ??
    ({ resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdt', symbol: 'USDT' }) } as any);
  const coinListingEventService =
    overrides.coinListingEventService ?? ({ getActiveDelistingsAsOf: jest.fn().mockResolvedValue(new Map()) } as any);

  const barProcessor = new BacktestBarProcessor(
    backtestStream,
    algorithmRegistry,
    portfolioState,
    signalThrottle,
    priceWindowService,
    compositeRegimeService,
    slippageContextService,
    checkpointService,
    exitSignalProcessor,
    forcedExitService,
    tradeExecutor,
    metricsAccumulatorService,
    opportunitySellService,
    signalTradeService
  );
  const loopRunner = new BacktestLoopRunner(
    backtestStream,
    algorithmRegistry,
    ohlcService,
    marketDataReader,
    quoteCurrencyResolver,
    slippageService,
    portfolioState,
    signalThrottle,
    coinListingEventService,
    priceWindowService,
    compositeRegimeService,
    slippageContextService,
    checkpointService,
    exitSignalProcessor,
    forcedExitService,
    tradeExecutor,
    metricsAccumulatorService,
    opportunitySellService,
    barProcessor
  );
  const optimizationCore = overrides.optimizationCore ?? ({} as any);
  return new BacktestEngine(checkpointService, optimizationCore, loopRunner);
};

describe('BacktestEngine mapStrategySignal: STOP_LOSS and TAKE_PROFIT', () => {
  const createEngine = (algorithmRegistry: any, ohlcService: any) => createTestEngine(algorithmRegistry, ohlcService);

  const createCandles = (coinId: string) => [
    new OHLCCandle({
      coinId,
      exchangeId: 'exchange-1',
      timestamp: new Date('2024-01-01T00:00:00.000Z'),
      open: 100,
      high: 110,
      low: 96,
      close: 100,
      volume: 1000
    }),
    new OHLCCandle({
      coinId,
      exchangeId: 'exchange-1',
      timestamp: new Date('2024-01-01T01:00:00.000Z'),
      open: 100,
      high: 110,
      low: 96,
      close: 100,
      volume: 1000
    })
  ];

  it.each([
    { signalType: SignalType.STOP_LOSS, reason: 'stop triggered', label: 'STOP_LOSS' },
    { signalType: SignalType.TAKE_PROFIT, reason: 'target reached', label: 'TAKE_PROFIT' }
  ])('maps $label signals to SELL and produces trades', async ({ signalType, reason, label }) => {
    const algorithmRegistry = {
      executeAlgorithm: jest
        .fn()
        .mockResolvedValueOnce({
          success: true,
          signals: [
            { type: SignalType.BUY, coinId: 'BTC', quantity: 1, strength: 0.5, reason: 'entry', confidence: 0.8 }
          ]
        })
        .mockResolvedValueOnce({
          success: true,
          signals: [{ type: signalType, coinId: 'BTC', quantity: 1, strength: 0.8, reason, confidence: 0.9 }]
        })
    };
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(createCandles('BTC')) };
    const engine = createEngine(algorithmRegistry, ohlcService);

    const result = await engine.executeHistoricalBacktest(
      {
        id: `bt-${label.toLowerCase()}`,
        name: `${label} Test`,
        initialCapital: 10000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-01T02:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: `dataset-${label.toLowerCase()}`,
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-01T02:00:00.000Z')
        } as any,
        deterministicSeed: `seed-${label.toLowerCase()}`
      }
    );

    expect(result.trades).toHaveLength(2);
    expect(result.trades[0].type).toBe('BUY');
    expect(result.trades[1].type).toBe('SELL');
    expect(result.signals).toHaveLength(2);
  });
});

describe('BacktestEngine.executeOptimizationBacktest', () => {
  const createEngine = (algorithmRegistry: any, ohlcService: any) =>
    createTestEngine(algorithmRegistry, ohlcService, {
      optimizationCore: createOptimizationCore(algorithmRegistry, ohlcService)
    });

  it('rethrows AlgorithmNotRegisteredException', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockRejectedValue(new AlgorithmNotRegisteredException('algo-1'))
    };
    const startDate = new Date('2024-01-01T00:00:00.000Z');
    const endDate = new Date('2024-01-02T00:00:00.000Z');
    const candle = new OHLCCandle({
      coinId: 'coin-1',
      exchangeId: 'exchange-1',
      timestamp: startDate,
      open: 100,
      high: 110,
      low: 96,
      close: 105,
      volume: 1000
    });
    const ohlcService = {
      getCandlesByDateRange: jest.fn().mockResolvedValue([candle])
    };
    const engine = createEngine(algorithmRegistry, ohlcService);

    const config = {
      algorithmId: 'algo-1',
      parameters: {},
      startDate,
      endDate
    };

    await expect(engine.executeOptimizationBacktest(config, [{ id: 'coin-1' }] as any)).rejects.toBeInstanceOf(
      AlgorithmNotRegisteredException
    );
    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledWith(
      'algo-1',
      expect.objectContaining({
        config: {},
        metadata: expect.objectContaining({ isOptimization: true, algorithmId: 'algo-1' })
      })
    );
  });

  it('returns neutral metrics when there is no price data', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn()
    };
    const ohlcService = {
      getCandlesByDateRange: jest.fn().mockResolvedValue([])
    };
    const engine = createEngine(algorithmRegistry, ohlcService);

    const result = await engine.executeOptimizationBacktest(
      {
        algorithmId: 'algo-1',
        parameters: {},
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-02T00:00:00.000Z')
      },
      [{ id: 'coin-1' }] as any
    );

    expect(result).toEqual(
      expect.objectContaining({
        sharpeRatio: 0,
        totalReturn: 0,
        maxDrawdown: 0,
        winRate: 0,
        volatility: 0,
        profitFactor: 1,
        tradeCount: 0
      })
    );
    expect(algorithmRegistry.executeAlgorithm).not.toHaveBeenCalled();
  });

  it('returns annualized return and final value when price data exists', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({ success: true, signals: [] })
    };
    const ohlcService = {
      getCandlesByDateRange: jest.fn()
    };
    const engine = createEngine(algorithmRegistry, ohlcService);

    const startDate = new Date('2024-01-01T00:00:00.000Z');
    const endDate = new Date('2024-01-03T00:00:00.000Z');
    const candles = [
      new OHLCCandle({
        coinId: 'coin-1',
        exchangeId: 'exchange-1',
        timestamp: startDate,
        open: 100,
        high: 110,
        low: 96,
        close: 105,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'coin-1',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-02T00:00:00.000Z'),
        open: 105,
        high: 115,
        low: 96,
        close: 110,
        volume: 1000
      })
    ];

    ohlcService.getCandlesByDateRange.mockResolvedValue(candles);

    const result = await engine.executeOptimizationBacktest(
      {
        algorithmId: 'algo-1',
        parameters: { foo: 'bar' },
        startDate,
        endDate,
        initialCapital: 10000,
        tradingFee: 0.001
      },
      [{ id: 'coin-1' }] as any
    );

    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledWith(
      'algo-1',
      expect.objectContaining({
        config: { foo: 'bar' },
        metadata: expect.objectContaining({ isOptimization: true, algorithmId: 'algo-1' })
      })
    );
    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledTimes(2);
    expect(result.finalValue).toBeCloseTo(10000);
    expect(result.totalReturn).toBe(0);
    expect(result.annualizedReturn).toBe(0);
    expect(result.tradeCount).toBe(0);
    expect(result.profitFactor).toBe(1);
  });
});

describe('BacktestEngine.precomputeWindowData', () => {
  const createEngine = () => createTestEngine({} as any, {} as any, { optimizationCore: createOptimizationCore() });

  it('should pre-compute window data from candles', () => {
    const engine = createEngine();
    const startDate = new Date('2024-01-01T00:00:00.000Z');
    const endDate = new Date('2024-01-03T00:00:00.000Z');

    const candles = [
      new OHLCCandle({
        coinId: 'btc',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
        open: 100,
        high: 110,
        low: 96,
        close: 105,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'btc',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-02T00:00:00.000Z'),
        open: 105,
        high: 115,
        low: 100,
        close: 110,
        volume: 2000
      }),
      new OHLCCandle({
        coinId: 'btc',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-04T00:00:00.000Z'),
        open: 110,
        high: 120,
        low: 105,
        close: 115,
        volume: 3000
      })
    ];

    const candlesByCoin = new Map<string, OHLCCandle[]>();
    candlesByCoin.set('btc', candles);

    const coins = [{ id: 'btc' }] as any[];

    const result = engine.precomputeWindowData(coins, candlesByCoin, startDate, endDate);

    // Should only include candles within the date range (excludes Jan 4)
    expect(result.filteredCandles).toHaveLength(2);
    expect(result.timestamps).toHaveLength(2);
    expect(result.immutablePriceData.timestampsByCoin.get('btc')).toHaveLength(2);
    expect(result.immutablePriceData.summariesByCoin.get('btc')).toHaveLength(2);
    // Volume map should have entries
    expect(result.volumeMap.size).toBe(2);
  });

  it('should return empty data for empty candles', () => {
    const engine = createEngine();
    const candlesByCoin = new Map<string, OHLCCandle[]>();
    candlesByCoin.set('btc', []);

    const result = engine.precomputeWindowData(
      [{ id: 'btc' }] as any[],
      candlesByCoin,
      new Date('2024-01-01'),
      new Date('2024-01-02')
    );

    expect(result.filteredCandles).toHaveLength(0);
    expect(result.timestamps).toHaveLength(0);
    expect(result.volumeMap.size).toBe(0);
  });

  it('should default tradingStartIndex to 0', () => {
    const engine = createEngine();
    const candles = [
      new OHLCCandle({
        coinId: 'btc',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
        open: 100,
        high: 110,
        low: 96,
        close: 105,
        volume: 1000
      })
    ];
    const candlesByCoin = new Map<string, OHLCCandle[]>();
    candlesByCoin.set('btc', candles);

    const result = engine.precomputeWindowData(
      [{ id: 'btc' }] as any[],
      candlesByCoin,
      new Date('2024-01-01'),
      new Date('2024-01-02')
    );

    expect(result.tradingStartIndex).toBe(0);
  });
});

describe('BacktestEngine.runOptimizationBacktestWithPrecomputed', () => {
  const createEngine = (algorithmRegistry: any) =>
    createTestEngine(algorithmRegistry, {} as any, {
      optimizationCore: createOptimizationCore(algorithmRegistry)
    });

  it('returns neutral metrics when pre-computed data has no candles', async () => {
    const engine = createEngine({ executeAlgorithm: jest.fn() });
    const precomputed = {
      pricesByTimestamp: {},
      timestamps: [],
      immutablePriceData: { timestampsByCoin: new Map(), summariesByCoin: new Map() },
      volumeMap: new Map(),
      filteredCandles: [],
      tradingStartIndex: 0
    };

    const result = await engine.runOptimizationBacktestWithPrecomputed(
      {
        algorithmId: 'algo-1',
        parameters: {},
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-02')
      },
      [{ id: 'btc' }] as any[],
      precomputed
    );

    expect(result.sharpeRatio).toBe(0);
    expect(result.totalReturn).toBe(0);
    expect(result.tradeCount).toBe(0);
  });

  it('should skip trading during warm-up period (tradingStartIndex)', async () => {
    const executeAlgorithm = jest.fn().mockResolvedValue({
      success: true,
      signals: [{ coinId: 'btc', action: 'BUY', signalType: 'ENTRY', confidence: 0.8, reason: 'test' }]
    });
    const algorithmRegistry = {
      executeAlgorithm,
      getStrategyForAlgorithm: jest.fn().mockResolvedValue(null)
    };

    const engine = createEngine(algorithmRegistry);

    const candles = [
      new OHLCCandle({
        coinId: 'btc',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
        open: 100,
        high: 110,
        low: 96,
        close: 105,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'btc',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-02T00:00:00.000Z'),
        open: 105,
        high: 115,
        low: 100,
        close: 110,
        volume: 2000
      }),
      new OHLCCandle({
        coinId: 'btc',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-03T00:00:00.000Z'),
        open: 110,
        high: 120,
        low: 105,
        close: 115,
        volume: 3000
      })
    ];

    const coins = [{ id: 'btc' }] as any[];
    const candlesByCoin = new Map<string, OHLCCandle[]>();
    candlesByCoin.set('btc', candles);

    const precomputed = engine.precomputeWindowData(
      coins,
      candlesByCoin,
      new Date('2024-01-01T00:00:00.000Z'),
      new Date('2024-01-04T00:00:00.000Z')
    );
    // Set tradingStartIndex to skip first 2 timestamps (warm-up period)
    precomputed.tradingStartIndex = 2;

    const config = {
      algorithmId: 'algo-1',
      parameters: {},
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-01-04'),
      initialCapital: 10000,
      tradingFee: 0.001
    };

    const result = await engine.runOptimizationBacktestWithPrecomputed(config, coins, precomputed);

    // Algorithm should only be called for the non-warmup timestamp (index 2)
    // First 2 timestamps are skipped via continue before algorithm execution
    expect(executeAlgorithm).toHaveBeenCalledTimes(1);

    // Portfolio should still be at initial capital (no successful trades in 1 timestamp)
    expect(result.totalReturn).toBeCloseTo(0, 1);
  });

  it('produces same results as runOptimizationBacktestCore for same data', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({ success: true, signals: [] }),
      getStrategyForAlgorithm: jest.fn().mockResolvedValue(null)
    };

    const engine = createEngine(algorithmRegistry);

    const startDate = new Date('2024-01-01T00:00:00.000Z');
    const endDate = new Date('2024-01-03T00:00:00.000Z');
    const candles = [
      new OHLCCandle({
        coinId: 'btc',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
        open: 100,
        high: 110,
        low: 96,
        close: 105,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'btc',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-02T00:00:00.000Z'),
        open: 105,
        high: 115,
        low: 100,
        close: 110,
        volume: 2000
      })
    ];

    const coins = [{ id: 'btc' }] as any[];
    const candlesByCoin = new Map<string, OHLCCandle[]>();
    candlesByCoin.set('btc', candles);

    // Build pre-computed data
    const precomputed = engine.precomputeWindowData(coins, candlesByCoin, startDate, endDate);

    const config = {
      algorithmId: 'algo-1',
      parameters: {},
      startDate,
      endDate,
      initialCapital: 10000,
      tradingFee: 0.001
    };

    const precomputedResult = await engine.runOptimizationBacktestWithPrecomputed(config, coins, precomputed);

    // Compare with legacy path
    const legacyResult = await engine.executeOptimizationBacktestWithData(config, coins, candlesByCoin);

    // Results should match (both have no trades, same initial capital)
    expect(precomputedResult.totalReturn).toBe(legacyResult.totalReturn);
    expect(precomputedResult.tradeCount).toBe(legacyResult.tradeCount);
    expect(legacyResult.finalValue).toBeDefined();
    expect(precomputedResult.finalValue).toBeCloseTo(legacyResult.finalValue as number);
    expect(precomputedResult.maxDrawdown).toBe(legacyResult.maxDrawdown);
    expect(precomputedResult.profitFactor).toBe(legacyResult.profitFactor);
  });
});

describe('BacktestEngine.executeLiveReplayBacktest', () => {
  const createEngine = (deps: {
    algorithmRegistry: any;
    marketDataReader: any;
    ohlcService: any;
    quoteCurrencyResolver: any;
  }) =>
    createTestEngine(deps.algorithmRegistry, deps.ohlcService, {
      marketDataReader: deps.marketDataReader,
      quoteCurrencyResolver: deps.quoteCurrencyResolver
    });

  const createCandles = () => [
    new OHLCCandle({
      coinId: 'BTC',
      exchangeId: 'exchange-1',
      timestamp: new Date('2024-01-01T00:00:00.000Z'),
      open: 100,
      high: 110,
      low: 96,
      close: 100,
      volume: 1000
    }),
    new OHLCCandle({
      coinId: 'BTC',
      exchangeId: 'exchange-1',
      timestamp: new Date('2024-01-01T01:00:00.000Z'),
      open: 100,
      high: 110,
      low: 96,
      close: 100,
      volume: 1000
    })
  ];

  it('pauses and returns a checkpoint when shouldPause resolves true', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({ success: true, signals: [] })
    };
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(createCandles()) };
    const marketDataReader = { hasStorageLocation: jest.fn().mockReturnValue(false) };
    const quoteCurrencyResolver = { resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdt', symbol: 'USDT' }) };

    const engine = createEngine({ algorithmRegistry, marketDataReader, ohlcService, quoteCurrencyResolver });

    const shouldPause = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const onPaused = jest.fn().mockResolvedValue(undefined);

    const result = await engine.executeLiveReplayBacktest(
      {
        id: 'backtest-1',
        name: 'Live Replay',
        initialCapital: 1000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-01T02:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-1',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-01T02:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-1',
        replaySpeed: ReplaySpeed.MAX_SPEED,
        shouldPause,
        onPaused
      }
    );

    expect(result.paused).toBe(true);
    expect(result.pausedCheckpoint?.lastProcessedIndex).toBe(0);
    expect(result.snapshots).toHaveLength(1);
    expect(onPaused).toHaveBeenCalledTimes(1);
    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledTimes(1);
  });

  it('emits checkpoint results with incremental slices', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest
        .fn()
        .mockResolvedValueOnce({
          success: true,
          signals: [
            {
              type: SignalType.BUY,
              coinId: 'BTC',
              quantity: 1,
              reason: 'entry'
            }
          ]
        })
        .mockResolvedValueOnce({ success: true, signals: [] })
    };
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(createCandles()) };
    const marketDataReader = { hasStorageLocation: jest.fn().mockReturnValue(false) };
    const quoteCurrencyResolver = { resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdt', symbol: 'USDT' }) };

    const engine = createEngine({ algorithmRegistry, marketDataReader, ohlcService, quoteCurrencyResolver });

    const onCheckpoint = jest.fn().mockResolvedValue(undefined);

    await engine.executeLiveReplayBacktest(
      {
        id: 'backtest-2',
        name: 'Checkpoint Replay',
        initialCapital: 1000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-01T02:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-2',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-01T02:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-2',
        replaySpeed: ReplaySpeed.MAX_SPEED,
        checkpointInterval: 1,
        onCheckpoint
      }
    );

    expect(onCheckpoint).toHaveBeenCalled();
    const [, firstResults, totalTimestamps] = onCheckpoint.mock.calls[0];
    expect(totalTimestamps).toBe(2);
    expect(firstResults.trades).toHaveLength(1);
    expect(firstResults.signals).toHaveLength(1);
    expect(firstResults.simulatedFills).toHaveLength(1);
    expect(firstResults.snapshots).toHaveLength(1);
  });

  it('continues execution when pause check fails transiently', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({ success: true, signals: [] })
    };
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(createCandles()) };
    const marketDataReader = { hasStorageLocation: jest.fn().mockReturnValue(false) };
    const quoteCurrencyResolver = { resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdt', symbol: 'USDT' }) };

    const engine = createEngine({ algorithmRegistry, marketDataReader, ohlcService, quoteCurrencyResolver });

    // Pause check fails once but then succeeds
    const shouldPause = jest.fn().mockRejectedValueOnce(new Error('Redis unavailable')).mockResolvedValue(false);

    const result = await engine.executeLiveReplayBacktest(
      {
        id: 'backtest-transient',
        name: 'Transient Failure Test',
        initialCapital: 1000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-01T02:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-transient',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-01T02:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-transient',
        replaySpeed: ReplaySpeed.MAX_SPEED,
        shouldPause
      }
    );

    // Should complete normally despite transient failure
    expect(result.paused).toBe(false);
    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledTimes(2);
  });

  it('forces precautionary pause after 3 consecutive pause check failures', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({ success: true, signals: [] })
    };

    // Create more candles so we have enough iterations for 3 failures
    const candles = [
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
        open: 100,
        high: 110,
        low: 96,
        close: 100,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-01T01:00:00.000Z'),
        open: 100,
        high: 110,
        low: 96,
        close: 100,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-01T02:00:00.000Z'),
        open: 100,
        high: 110,
        low: 96,
        close: 100,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-01T03:00:00.000Z'),
        open: 100,
        high: 110,
        low: 96,
        close: 100,
        volume: 1000
      })
    ];

    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(candles) };
    const marketDataReader = { hasStorageLocation: jest.fn().mockReturnValue(false) };
    const quoteCurrencyResolver = { resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdt', symbol: 'USDT' }) };

    const engine = createEngine({ algorithmRegistry, marketDataReader, ohlcService, quoteCurrencyResolver });

    // Pause check fails 3 times consecutively (threshold)
    const shouldPause = jest.fn().mockRejectedValue(new Error('Redis unavailable'));
    const onPaused = jest.fn().mockResolvedValue(undefined);

    const result = await engine.executeLiveReplayBacktest(
      {
        id: 'backtest-consecutive-fail',
        name: 'Consecutive Failure Test',
        initialCapital: 1000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-01T04:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-fail',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-01T04:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-fail',
        replaySpeed: ReplaySpeed.MAX_SPEED,
        shouldPause,
        onPaused
      }
    );

    // Should force pause after 3 consecutive failures
    expect(result.paused).toBe(true);
    expect(onPaused).toHaveBeenCalledTimes(1);
    // Should have processed fewer timestamps than available
    expect(algorithmRegistry.executeAlgorithm.mock.calls.length).toBeLessThan(4);
  });

  it('resets pause failure counter on successful pause check', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({ success: true, signals: [] })
    };

    // Create 5 candles
    const candles = [1, 2, 3, 4, 5].map(
      (i) =>
        new OHLCCandle({
          coinId: 'BTC',
          exchangeId: 'exchange-1',
          timestamp: new Date(`2024-01-01T0${i - 1}:00:00.000Z`),
          open: 100,
          high: 110,
          low: 96,
          close: 100,
          volume: 1000
        })
    );

    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(candles) };
    const marketDataReader = { hasStorageLocation: jest.fn().mockReturnValue(false) };
    const quoteCurrencyResolver = { resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdt', symbol: 'USDT' }) };

    const engine = createEngine({ algorithmRegistry, marketDataReader, ohlcService, quoteCurrencyResolver });

    // Fail twice, succeed, fail twice again - should NOT trigger precautionary pause
    const shouldPause = jest
      .fn()
      .mockRejectedValueOnce(new Error('Redis error'))
      .mockRejectedValueOnce(new Error('Redis error'))
      .mockResolvedValueOnce(false) // Success resets counter
      .mockRejectedValueOnce(new Error('Redis error'))
      .mockResolvedValueOnce(false);

    const result = await engine.executeLiveReplayBacktest(
      {
        id: 'backtest-reset-counter',
        name: 'Reset Counter Test',
        initialCapital: 1000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-01T05:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-reset',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-01T05:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-reset',
        replaySpeed: ReplaySpeed.MAX_SPEED,
        shouldPause
      }
    );

    // Should complete normally since counter resets on success
    expect(result.paused).toBe(false);
    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledTimes(5);
  });

  it('includes cumulative counts in pause checkpoint after prior checkpoints', async () => {
    // Regression test for C1: pause paths must use cumulative counts, not just
    // the current (post-clear) array lengths, so that resume sees all trades.
    let callCount = 0;
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockImplementation(() => {
        callCount++;
        const action = callCount % 2 === 1 ? SignalType.BUY : SignalType.SELL;
        return Promise.resolve({
          success: true,
          signals: [{ type: action, coinId: 'BTC', quantity: 0.1, reason: 'entry', confidence: 0.5 }]
        });
      })
    };

    // 4 candles → 4 iterations: checkpoint fires after iteration 0, then pause at iteration 2
    // Spaced 25h apart so SELL signals aren't blocked by the 24h minimum hold period
    const candles = [0, 1, 2, 3].map(
      (i) =>
        new OHLCCandle({
          coinId: 'BTC',
          exchangeId: 'exchange-1',
          timestamp: new Date(new Date('2024-01-01T00:00:00.000Z').getTime() + i * 25 * 60 * 60 * 1000),
          open: 100,
          high: 110,
          low: 96,
          close: 100,
          volume: 1000
        })
    );

    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(candles) };
    const marketDataReader = { hasStorageLocation: jest.fn().mockReturnValue(false) };
    const quoteCurrencyResolver = {
      resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdt', symbol: 'USDT' })
    };

    const engine = createEngine({ algorithmRegistry, marketDataReader, ohlcService, quoteCurrencyResolver });

    const onCheckpoint = jest.fn().mockResolvedValue(undefined);
    // Pause after 3 iterations (indices 0, 1, 2 processed, pause check at start of index 3)
    const shouldPause = jest
      .fn()
      .mockResolvedValueOnce(false) // i=0
      .mockResolvedValueOnce(false) // i=1
      .mockResolvedValueOnce(false) // i=2
      .mockResolvedValueOnce(true); // i=3 → pause

    const onPaused = jest.fn().mockResolvedValue(undefined);

    const result = await engine.executeLiveReplayBacktest(
      {
        id: 'backtest-c1-regression',
        name: 'C1 Regression',
        initialCapital: 100000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-05T00:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: { cooldownMs: 0, maxTradesPerDay: 0 } }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-c1',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-05T00:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-c1',
        replaySpeed: ReplaySpeed.MAX_SPEED,
        checkpointInterval: 1, // checkpoint after every iteration
        onCheckpoint,
        shouldPause,
        onPaused
      }
    );

    expect(result.paused).toBe(true);
    expect(onPaused).toHaveBeenCalledTimes(1);

    // Verify pause checkpoint has cumulative counts, not just partial
    const pausedCheckpoint = result.pausedCheckpoint;
    expect(pausedCheckpoint).toBeDefined();
    // Alternating BUY/SELL: iteration 0=BUY, 1=SELL, 2=BUY → 3 trades after 3 iterations
    // With checkpointInterval=1, arrays get cleared at checkpoints.
    // The bug was that pause used trades.length (partial) instead of totalPersistedCounts + trades.length (cumulative)
    expect(pausedCheckpoint?.persistedCounts.trades).toBe(3);

    // One SELL executed (iteration 1), price unchanged so PnL=0 → not a winning sell
    expect(pausedCheckpoint?.persistedCounts.sells).toBe(1);
    expect(pausedCheckpoint?.persistedCounts.winningSells).toBe(0);

    // Final metrics should also reflect all trades across checkpoints
    expect(result.finalMetrics.totalTrades).toBe(3);
  });

  it('persists cumulative sell/winningSell counts across checkpoints for accurate resume winRate', async () => {
    // Regression test: sell counts must survive checkpoint+resume for correct winRate.
    // Iteration 0: BUY 1 BTC @ 100 → position opened
    // Iteration 1: SELL 1 BTC @ 120 → winning sell (realizedPnL = 20)
    // Iteration 2: BUY 1 BTC @ 120
    // Iteration 3: SELL 1 BTC @ 110 → losing sell (realizedPnL = -10)
    // With checkpointInterval=1, arrays are cleared after each checkpoint.
    // Without the fix, resume would lose sell counts from earlier checkpoints.
    let callCount = 0;
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Iteration 0: BUY
          return Promise.resolve({
            success: true,
            signals: [{ type: SignalType.BUY, coinId: 'BTC', quantity: 1, reason: 'entry', confidence: 0.8 }]
          });
        } else if (callCount === 2) {
          // Iteration 1: SELL (winning)
          return Promise.resolve({
            success: true,
            signals: [{ type: SignalType.SELL, coinId: 'BTC', quantity: 1, reason: 'take-profit', confidence: 1 }]
          });
        } else if (callCount === 3) {
          // Iteration 2: BUY again
          return Promise.resolve({
            success: true,
            signals: [{ type: SignalType.BUY, coinId: 'BTC', quantity: 1, reason: 'entry', confidence: 0.8 }]
          });
        } else if (callCount === 4) {
          // Iteration 3: SELL (losing)
          return Promise.resolve({
            success: true,
            signals: [{ type: SignalType.SELL, coinId: 'BTC', quantity: 1, reason: 'exit', confidence: 1 }]
          });
        }
        return Promise.resolve({ success: true, signals: [] });
      })
    };

    // Prices: 100, 120, 120, 110 → first sell wins, second sell loses
    // Timestamps spaced 25h apart so positions satisfy min hold period (24h)
    const candles = [
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'e1',
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
        open: 100,
        high: 110,
        low: 96,
        close: 100,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'e1',
        timestamp: new Date('2024-01-02T01:00:00.000Z'),
        open: 100,
        high: 130,
        low: 96,
        close: 120,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'e1',
        timestamp: new Date('2024-01-03T02:00:00.000Z'),
        open: 120,
        high: 125,
        low: 115,
        close: 120,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'e1',
        timestamp: new Date('2024-01-04T03:00:00.000Z'),
        open: 120,
        high: 120,
        low: 105,
        close: 110,
        volume: 1000
      })
    ];

    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(candles) };
    const marketDataReader = { hasStorageLocation: jest.fn().mockReturnValue(false) };
    const quoteCurrencyResolver = { resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdt', symbol: 'USDT' }) };

    const engine = createEngine({ algorithmRegistry, marketDataReader, ohlcService, quoteCurrencyResolver });

    const capturedCheckpoints: any[] = [];
    const onCheckpoint = jest.fn().mockImplementation((state) => {
      capturedCheckpoints.push(JSON.parse(JSON.stringify(state)));
      return Promise.resolve();
    });

    const result = await engine.executeLiveReplayBacktest(
      {
        id: 'backtest-sell-counts',
        name: 'Sell Count Test',
        initialCapital: 10000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-05T00:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-sells',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-05T00:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-sells',
        replaySpeed: ReplaySpeed.MAX_SPEED,
        checkpointInterval: 1,
        onCheckpoint
      }
    );

    expect(result.paused).toBe(false);

    // After iteration 1 (BUY + SELL winning): should have 1 sell, 1 winning sell
    const cp1 = capturedCheckpoints.find((cp) => cp.persistedCounts.sells >= 1);
    expect(cp1).toBeDefined();
    expect(cp1.persistedCounts.sells).toBe(1);
    expect(cp1.persistedCounts.winningSells).toBe(1);

    // Final metrics should reflect 2 sells total, 1 winning → winRate = 0.5
    expect(result.finalMetrics.totalTrades).toBe(4); // 2 buys + 2 sells
    expect(result.finalMetrics.winRate).toBeCloseTo(0.5); // 1 winning / 2 sells
    expect(result.finalMetrics.winningTrades).toBe(1);
  });

  it('restores sell/winning sell counts on resume for accurate winRate', async () => {
    // Simulate a backtest that was checkpointed with known sell counts,
    // then resumed with additional trades. The final winRate must reflect
    // the full run, not just the resumed portion.

    // Phase 1: Run 2 iterations (BUY then winning SELL), capture checkpoint
    let phase1CallCount = 0;
    const phase1Registry = {
      executeAlgorithm: jest.fn().mockImplementation(() => {
        phase1CallCount++;
        if (phase1CallCount === 1) {
          return Promise.resolve({
            success: true,
            signals: [{ type: SignalType.BUY, coinId: 'BTC', quantity: 1, reason: 'entry', confidence: 0.8 }]
          });
        } else if (phase1CallCount === 2) {
          return Promise.resolve({
            success: true,
            signals: [{ type: SignalType.SELL, coinId: 'BTC', quantity: 1, reason: 'take-profit', confidence: 1 }]
          });
        }
        return Promise.resolve({ success: true, signals: [] });
      })
    };

    // Timestamps spaced 25h apart so positions satisfy min hold period (24h)
    const phase1Candles = [
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'e1',
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
        open: 100,
        high: 110,
        low: 96,
        close: 100,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'e1',
        timestamp: new Date('2024-01-02T01:00:00.000Z'),
        open: 100,
        high: 130,
        low: 96,
        close: 120,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'e1',
        timestamp: new Date('2024-01-03T02:00:00.000Z'),
        open: 120,
        high: 125,
        low: 115,
        close: 120,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'e1',
        timestamp: new Date('2024-01-04T03:00:00.000Z'),
        open: 120,
        high: 120,
        low: 105,
        close: 110,
        volume: 1000
      })
    ];

    const ohlcService1 = { getCandlesByDateRange: jest.fn().mockResolvedValue(phase1Candles) };
    const marketDataReader = { hasStorageLocation: jest.fn().mockReturnValue(false) };
    const quoteCurrencyResolver = { resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdt', symbol: 'USDT' }) };

    const engine1 = createEngine({
      algorithmRegistry: phase1Registry,
      marketDataReader,
      ohlcService: ohlcService1,
      quoteCurrencyResolver
    });

    // Pause after 2 iterations to capture checkpoint with 1 winning sell
    const shouldPause = jest
      .fn()
      .mockResolvedValueOnce(false) // i=0 BUY
      .mockResolvedValueOnce(false) // i=1 SELL
      .mockResolvedValueOnce(true); // i=2 → pause

    const onPaused = jest.fn().mockResolvedValue(undefined);
    const onCheckpoint = jest.fn().mockResolvedValue(undefined);

    const phase1Result = await engine1.executeLiveReplayBacktest(
      {
        id: 'backtest-resume-winrate',
        name: 'Resume WinRate',
        initialCapital: 10000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-05T00:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-resume',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-05T00:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-resume',
        replaySpeed: ReplaySpeed.MAX_SPEED,
        checkpointInterval: 1,
        onCheckpoint,
        shouldPause,
        onPaused
      }
    );

    expect(phase1Result.paused).toBe(true);
    const checkpoint = phase1Result.pausedCheckpoint;
    expect(checkpoint).toBeDefined();
    // Phase 1: 1 BUY + 1 SELL (winning) → sells=1, winningSells=1
    expect(checkpoint?.persistedCounts.sells).toBe(1);
    expect(checkpoint?.persistedCounts.winningSells).toBe(1);

    // Phase 2: Resume from checkpoint. Iterations 2,3 → BUY then losing SELL
    let phase2CallCount = 0;
    const phase2Registry = {
      executeAlgorithm: jest.fn().mockImplementation(() => {
        phase2CallCount++;
        if (phase2CallCount === 1) {
          // Iteration 2: BUY
          return Promise.resolve({
            success: true,
            signals: [{ type: SignalType.BUY, coinId: 'BTC', quantity: 1, reason: 'entry', confidence: 0.8 }]
          });
        } else if (phase2CallCount === 2) {
          // Iteration 3: SELL (losing, price dropped from 120 → 110)
          return Promise.resolve({
            success: true,
            signals: [{ type: SignalType.SELL, coinId: 'BTC', quantity: 1, reason: 'exit', confidence: 1 }]
          });
        }
        return Promise.resolve({ success: true, signals: [] });
      })
    };

    const ohlcService2 = { getCandlesByDateRange: jest.fn().mockResolvedValue(phase1Candles) };
    const engine2 = createEngine({
      algorithmRegistry: phase2Registry,
      marketDataReader,
      ohlcService: ohlcService2,
      quoteCurrencyResolver
    });

    const phase2Result = await engine2.executeLiveReplayBacktest(
      {
        id: 'backtest-resume-winrate',
        name: 'Resume WinRate',
        initialCapital: 10000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-05T00:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-resume',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-05T00:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-resume',
        replaySpeed: ReplaySpeed.MAX_SPEED,
        resumeFrom: checkpoint
      }
    );

    expect(phase2Result.paused).toBe(false);
    // Full run: 2 sells total (1 winning from phase 1 + 1 losing from phase 2)
    // winRate should be 1/2 = 0.5, NOT 0/1 = 0 (which would happen without the fix)
    expect(phase2Result.finalMetrics.winRate).toBeCloseTo(0.5);
    expect(phase2Result.finalMetrics.winningTrades).toBe(1);
    // Total trades: 2 from phase 1 (persisted) + 2 from phase 2 = 4
    expect(phase2Result.finalMetrics.totalTrades).toBe(4);
  });

  it('blocks BUY signals in BEAR regime when enableRegimeGate is true', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({
        success: true,
        signals: [{ type: SignalType.BUY, coinId: 'BTC', quantity: 1, reason: 'entry', confidence: 0.8 }]
      })
    };
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(createCandles()) };
    const marketDataReader = { hasStorageLocation: jest.fn().mockReturnValue(false) };
    const quoteCurrencyResolver = { resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdt', symbol: 'USDT' }) };

    const engine = createEngine({ algorithmRegistry, marketDataReader, ohlcService, quoteCurrencyResolver });

    // Spy on computeCompositeRegime to return BEAR regime
    jest.spyOn(compositeRegimeService, 'computeCompositeRegime').mockReturnValue({
      compositeRegime: CompositeRegimeType.BEAR,
      volatilityRegime: MarketRegimeType.HIGH_VOLATILITY
    });

    const result = await engine.executeLiveReplayBacktest(
      {
        id: 'backtest-regime-gate',
        name: 'Regime Gate Test',
        initialCapital: 1000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-01T02:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-regime',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-01T02:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-regime',
        replaySpeed: ReplaySpeed.MAX_SPEED,
        enableRegimeGate: true
      }
    );

    // BUY signals should be filtered out in BEAR regime — no trades executed
    expect(result.trades).toHaveLength(0);
    // Signals are still recorded (filtering happens after signal recording in the throttle step,
    // but the mapped trading signals are filtered before trade execution)
    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledTimes(2);
  });

  it('allows BUY signals through in BEAR regime when enableRegimeGate is false', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({
        success: true,
        signals: [{ type: SignalType.BUY, coinId: 'BTC', quantity: 1, reason: 'entry', confidence: 0.8 }]
      })
    };
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(createCandles()) };
    const marketDataReader = { hasStorageLocation: jest.fn().mockReturnValue(false) };
    const quoteCurrencyResolver = { resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdt', symbol: 'USDT' }) };

    const engine = createEngine({ algorithmRegistry, marketDataReader, ohlcService, quoteCurrencyResolver });

    // Spy on computeCompositeRegime to return BEAR regime
    jest.spyOn(compositeRegimeService, 'computeCompositeRegime').mockReturnValue({
      compositeRegime: CompositeRegimeType.BEAR,
      volatilityRegime: MarketRegimeType.HIGH_VOLATILITY
    });

    const result = await engine.executeLiveReplayBacktest(
      {
        id: 'backtest-no-gate',
        name: 'Regime Gate Disabled Test',
        initialCapital: 1000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-01T02:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-no-gate',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-01T02:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-no-gate',
        replaySpeed: ReplaySpeed.MAX_SPEED,
        enableRegimeGate: false
      }
    );

    // BUY signals should NOT be filtered when regime gate is disabled — trades should execute
    expect(result.trades.length).toBeGreaterThan(0);
    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledTimes(2);
  });

  it('derives regime gate ON from risk level 1 when enableRegimeGate is not set', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({
        success: true,
        signals: [{ type: SignalType.BUY, coinId: 'BTC', quantity: 1, reason: 'entry', confidence: 0.8 }]
      })
    };
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(createCandles()) };
    const marketDataReader = { hasStorageLocation: jest.fn().mockReturnValue(false) };
    const quoteCurrencyResolver = { resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdt', symbol: 'USDT' }) };

    const engine = createEngine({ algorithmRegistry, marketDataReader, ohlcService, quoteCurrencyResolver });

    // Spy on computeCompositeRegime to return BEAR regime
    jest.spyOn(compositeRegimeService, 'computeCompositeRegime').mockReturnValue({
      compositeRegime: CompositeRegimeType.BEAR,
      volatilityRegime: MarketRegimeType.HIGH_VOLATILITY
    });

    const result = await engine.executeLiveReplayBacktest(
      {
        id: 'backtest-risk1-gate',
        name: 'Risk Level 1 Gate Derivation',
        initialCapital: 1000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-01T02:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-risk1',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-01T02:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-risk1',
        replaySpeed: ReplaySpeed.MAX_SPEED,
        riskLevel: 1
        // enableRegimeGate NOT set — should derive ON from riskLevel <= 2
      }
    );

    // Risk level 1 → gate derived ON → BUY signals blocked in BEAR regime
    expect(result.trades).toHaveLength(0);
    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledTimes(2);
  });

  it('derives regime gate OFF from risk level 3 when enableRegimeGate is not set', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({
        success: true,
        signals: [{ type: SignalType.BUY, coinId: 'BTC', quantity: 1, reason: 'entry', confidence: 0.8 }]
      })
    };
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(createCandles()) };
    const marketDataReader = { hasStorageLocation: jest.fn().mockReturnValue(false) };
    const quoteCurrencyResolver = { resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdt', symbol: 'USDT' }) };

    const engine = createEngine({ algorithmRegistry, marketDataReader, ohlcService, quoteCurrencyResolver });

    // Spy on computeCompositeRegime to return BEAR regime
    jest.spyOn(compositeRegimeService, 'computeCompositeRegime').mockReturnValue({
      compositeRegime: CompositeRegimeType.BEAR,
      volatilityRegime: MarketRegimeType.HIGH_VOLATILITY
    });

    const result = await engine.executeLiveReplayBacktest(
      {
        id: 'backtest-risk3-gate',
        name: 'Risk Level 3 Gate Derivation',
        initialCapital: 1000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-01T02:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-risk3',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-01T02:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-risk3',
        replaySpeed: ReplaySpeed.MAX_SPEED,
        riskLevel: 3
        // enableRegimeGate NOT set — should derive OFF from riskLevel >= 3
      }
    );

    // Risk level 3 → gate derived OFF → BUY signals pass through in BEAR regime
    expect(result.trades.length).toBeGreaterThan(0);
    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledTimes(2);
  });
});

describe('BacktestEngine checkpointing', () => {
  const createEngine = () => createTestEngine({} as any, {} as any);

  let engine: BacktestEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  const createCheckpoint = (_eng: BacktestEngine) => {
    const portfolio: Portfolio = {
      cashBalance: 1000,
      totalValue: 1200,
      positions: new Map([
        [
          'BTC',
          {
            coinId: 'BTC',
            quantity: 2,
            averagePrice: 100,
            totalValue: 200
          }
        ]
      ])
    };

    return checkpointService.buildCheckpointState(
      1,
      '2024-01-02T00:00:00.000Z',
      portfolio,
      1250,
      0.1,
      12345,
      2,
      3,
      4,
      5,
      0,
      0
    );
  };

  it('validates checkpoints with matching checksum', () => {
    const checkpoint = createCheckpoint(engine);

    const result = engine.validateCheckpoint(checkpoint, [
      '2024-01-01T00:00:00.000Z',
      '2024-01-02T00:00:00.000Z',
      '2024-01-03T00:00:00.000Z'
    ]);

    expect(result).toEqual({ valid: true });
  });

  it('detects corrupted checkpoints via checksum', () => {
    const checkpoint = createCheckpoint(engine);
    checkpoint.portfolio.cashBalance += 10;

    const result = engine.validateCheckpoint(checkpoint, ['2024-01-01T00:00:00.000Z', '2024-01-02T00:00:00.000Z']);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('checksum');
  });

  it('rejects checkpoints with timestamp mismatches', () => {
    const checkpoint = createCheckpoint(engine);

    const result = engine.validateCheckpoint(checkpoint, ['2024-01-01T00:00:00.000Z', '2024-01-04T00:00:00.000Z']);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Timestamp mismatch');
  });

  it('rejects checkpoints that are out of bounds', () => {
    const checkpoint = createCheckpoint(engine);
    checkpoint.lastProcessedIndex = 5;

    const result = engine.validateCheckpoint(checkpoint, ['2024-01-01T00:00:00.000Z']);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('out of bounds');
  });

  it('restores portfolio state from checkpoint data', () => {
    const checkpoint = createCheckpoint(createEngine());

    // Use shared portfolioState service directly since BacktestEngine delegates to it
    const restored = portfolioState.deserialize(checkpoint.portfolio);

    expect(restored.cashBalance).toBe(1000);
    expect(restored.positions.size).toBe(1);
    expect(restored.positions.get('BTC')).toEqual(
      expect.objectContaining({
        coinId: 'BTC',
        quantity: 2,
        averagePrice: 100,
        totalValue: 200
      })
    );
    expect(restored.totalValue).toBe(1200);
  });
});

describe('BacktestEngine warmup / date range separation', () => {
  const createEngine = (algorithmRegistry: any, ohlcService: any) => createTestEngine(algorithmRegistry, ohlcService);

  it('does not trade before backtest.startDate when dataset is broader', async () => {
    // Dataset: Jan 1-4, Backtest trading window: Jan 3-4
    // Jan 1-2 should be warmup only (no trades/signals)
    let callCount = 0;
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockImplementation(() => {
        callCount++;
        const action = callCount % 2 === 1 ? SignalType.BUY : SignalType.SELL;
        return Promise.resolve({
          success: true,
          signals: [{ type: action, coinId: 'BTC', quantity: 0.1, reason: 'entry', confidence: 0.5 }]
        });
      })
    };

    const candles = [1, 2, 3, 4].map(
      (day) =>
        new OHLCCandle({
          coinId: 'BTC',
          exchangeId: 'exchange-1',
          timestamp: new Date(`2024-01-0${day}T00:00:00.000Z`),
          open: 100,
          high: 110,
          low: 96,
          close: 100,
          volume: 1000
        })
    );
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(candles) };
    const engine = createEngine(algorithmRegistry, ohlcService);

    const result = await engine.executeHistoricalBacktest(
      {
        id: 'bt-warmup',
        name: 'Warmup Test',
        initialCapital: 10000,
        tradingFee: 0,
        startDate: new Date('2024-01-03T00:00:00.000Z'), // Trading starts Jan 3
        endDate: new Date('2024-01-04T00:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-warmup',
          startAt: new Date('2024-01-01T00:00:00.000Z'), // Dataset starts Jan 1
          endAt: new Date('2024-01-04T00:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-warmup'
      }
    );

    // Should only have trades from Jan 3 and Jan 4 (1 BUY + 1 SELL in trading window)
    expect(result.trades).toHaveLength(2);
    for (const trade of result.trades) {
      expect((trade.executedAt as Date).getTime()).toBeGreaterThanOrEqual(
        new Date('2024-01-03T00:00:00.000Z').getTime()
      );
    }

    // Algorithm is called for all 4 timestamps (2 warmup + 2 trading)
    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledTimes(4);
  });

  it('produces no snapshots during warmup period', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({ success: true, signals: [] })
    };

    const candles = [1, 2, 3, 4].map(
      (day) =>
        new OHLCCandle({
          coinId: 'BTC',
          exchangeId: 'exchange-1',
          timestamp: new Date(`2024-01-0${day}T00:00:00.000Z`),
          open: 100,
          high: 110,
          low: 96,
          close: 100,
          volume: 1000
        })
    );
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(candles) };
    const engine = createEngine(algorithmRegistry, ohlcService);

    const result = await engine.executeHistoricalBacktest(
      {
        id: 'bt-no-warmup-snap',
        name: 'No Warmup Snapshots',
        initialCapital: 10000,
        tradingFee: 0,
        startDate: new Date('2024-01-03T00:00:00.000Z'),
        endDate: new Date('2024-01-04T00:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-no-snap',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-04T00:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-no-snap'
      }
    );

    // All snapshots should be within the trading window
    for (const snapshot of result.snapshots) {
      expect((snapshot.timestamp as Date).getTime()).toBeGreaterThanOrEqual(
        new Date('2024-01-03T00:00:00.000Z').getTime()
      );
    }
  });

  it('does not trade after backtest.endDate even if dataset extends further', async () => {
    let callCount = 0;
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockImplementation(() => {
        callCount++;
        const action = callCount % 2 === 1 ? SignalType.BUY : SignalType.SELL;
        return Promise.resolve({
          success: true,
          signals: [{ type: action, coinId: 'BTC', quantity: 0.1, reason: 'entry', confidence: 0.5 }]
        });
      })
    };

    const candles = [1, 2, 3, 4].map(
      (day) =>
        new OHLCCandle({
          coinId: 'BTC',
          exchangeId: 'exchange-1',
          timestamp: new Date(`2024-01-0${day}T00:00:00.000Z`),
          open: 100,
          high: 110,
          low: 96,
          close: 100,
          volume: 1000
        })
    );
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(candles) };
    const engine = createEngine(algorithmRegistry, ohlcService);

    const result = await engine.executeHistoricalBacktest(
      {
        id: 'bt-end-trim',
        name: 'End Date Trim',
        initialCapital: 10000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-02T00:00:00.000Z'), // End before dataset ends
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-end-trim',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-04T00:00:00.000Z') // Dataset extends to Jan 4
        } as any,
        deterministicSeed: 'seed-end-trim'
      }
    );

    // Should only have trades from Jan 1 and Jan 2 (1 BUY + 1 SELL)
    expect(result.trades).toHaveLength(2);
    for (const trade of result.trades) {
      expect((trade.executedAt as Date).getTime()).toBeLessThanOrEqual(new Date('2024-01-02T00:00:00.000Z').getTime());
    }
  });

  it('behaves identically when dataset and backtest dates match', async () => {
    let callCount = 0;
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockImplementation(() => {
        callCount++;
        const action = callCount % 2 === 1 ? SignalType.BUY : SignalType.SELL;
        return Promise.resolve({
          success: true,
          signals: [{ type: action, coinId: 'BTC', quantity: 0.1, reason: 'entry', confidence: 0.5 }]
        });
      })
    };

    // Candles spaced 25h apart so SELL isn't blocked by 24h minimum hold period
    const candles = [
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
        open: 100,
        high: 110,
        low: 96,
        close: 100,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-02T01:00:00.000Z'),
        open: 100,
        high: 110,
        low: 96,
        close: 100,
        volume: 1000
      })
    ];
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(candles) };
    const engine = createEngine(algorithmRegistry, ohlcService);

    const result = await engine.executeHistoricalBacktest(
      {
        id: 'bt-matching',
        name: 'Matching Dates',
        initialCapital: 10000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-02T02:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: { cooldownMs: 0, maxTradesPerDay: 0 } }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-matching',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-02T02:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-matching'
      }
    );

    // No warmup, all periods are trading — 2 trades expected (1 BUY + 1 SELL)
    expect(result.trades).toHaveLength(2);
    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledTimes(2);
  });

  it('reports progress relative to trading period in checkpoints', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({
        success: true,
        signals: [{ type: SignalType.BUY, coinId: 'BTC', quantity: 0.1, reason: 'entry', confidence: 0.5 }]
      })
    };

    // 4 candles: 2 warmup + 2 trading
    const candles = [1, 2, 3, 4].map(
      (day) =>
        new OHLCCandle({
          coinId: 'BTC',
          exchangeId: 'exchange-1',
          timestamp: new Date(`2024-01-0${day}T00:00:00.000Z`),
          open: 100,
          high: 110,
          low: 96,
          close: 100,
          volume: 1000
        })
    );
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(candles) };
    const engine = createEngine(algorithmRegistry, ohlcService);

    const onCheckpoint = jest.fn().mockResolvedValue(undefined);

    await engine.executeHistoricalBacktest(
      {
        id: 'bt-progress',
        name: 'Progress Test',
        initialCapital: 10000,
        tradingFee: 0,
        startDate: new Date('2024-01-03T00:00:00.000Z'),
        endDate: new Date('2024-01-04T00:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-progress',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-04T00:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-progress',
        checkpointInterval: 1,
        onCheckpoint
      }
    );

    // Checkpoint totalTimestamps should reflect trading period (2), not full dataset (4)
    if (onCheckpoint.mock.calls.length > 0) {
      const [, , totalTimestamps] = onCheckpoint.mock.calls[0];
      expect(totalTimestamps).toBe(2);
    }
  });

  it('live replay: no trades before backtest.startDate with broader dataset', async () => {
    let callCount = 0;
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockImplementation(() => {
        callCount++;
        const action = callCount % 2 === 1 ? SignalType.BUY : SignalType.SELL;
        return Promise.resolve({
          success: true,
          signals: [{ type: action, coinId: 'BTC', quantity: 0.1, reason: 'entry', confidence: 0.5 }]
        });
      })
    };

    const candles = [1, 2, 3, 4].map(
      (day) =>
        new OHLCCandle({
          coinId: 'BTC',
          exchangeId: 'exchange-1',
          timestamp: new Date(`2024-01-0${day}T00:00:00.000Z`),
          open: 100,
          high: 110,
          low: 96,
          close: 100,
          volume: 1000
        })
    );
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(candles) };

    const engine = createEngine(algorithmRegistry, ohlcService);

    const result = await engine.executeLiveReplayBacktest(
      {
        id: 'bt-live-warmup',
        name: 'Live Replay Warmup',
        initialCapital: 10000,
        tradingFee: 0,
        startDate: new Date('2024-01-03T00:00:00.000Z'),
        endDate: new Date('2024-01-04T00:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-live-warmup',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-04T00:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-live-warmup',
        replaySpeed: ReplaySpeed.MAX_SPEED
      }
    );

    // Should only have trades from Jan 3 and Jan 4 (1 BUY + 1 SELL)
    expect(result.trades).toHaveLength(2);
    for (const trade of result.trades) {
      expect((trade.executedAt as Date).getTime()).toBeGreaterThanOrEqual(
        new Date('2024-01-03T00:00:00.000Z').getTime()
      );
    }
    expect(result.paused).toBe(false);
  });
});
