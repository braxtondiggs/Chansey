import { Test, type TestingModule } from '@nestjs/testing';

import { type OptimizationBacktestConfig } from './optimization-backtest.interface';
import { OptimizationCoreService } from './optimization-core.service';
import { OptimizationIndicatorPrecomputeService } from './optimization-indicator-precompute.service';

import { AlgorithmRegistry } from '../../../../algorithm/registry/algorithm-registry.service';
import { AlgorithmNotRegisteredException } from '../../../../common/exceptions';
import { type OHLCCandle } from '../../../../ohlc/ohlc-candle.entity';
import { OHLCService } from '../../../../ohlc/ohlc.service';
import { TradeExecutorService } from '../execution/trade-executor.service';
import { ExitSignalProcessorService } from '../exit-signals/exit-signal-processor.service';
import { MetricsCalculatorService } from '../metrics';
import { PortfolioStateService } from '../portfolio';
import { PriceWindowService } from '../price-window';
import { CompositeRegimeService } from '../regime/composite-regime.service';
import { SlippageContextService } from '../slippage-context/slippage-context.service';
import { SignalThrottleService } from '../throttle';

describe('OptimizationCoreService', () => {
  let service: OptimizationCoreService;

  let ohlcService: Record<string, jest.Mock>;
  let priceWindowService: Record<string, jest.Mock>;
  let portfolioState: Record<string, jest.Mock>;
  let algorithmRegistry: Record<string, jest.Mock>;
  let exitSignalProcessor: Record<string, jest.Mock>;
  let compositeRegimeService: Record<string, jest.Mock>;
  let signalThrottle: Record<string, jest.Mock>;
  let indicatorPrecompute: Record<string, jest.Mock>;
  let tradeExecutor: Record<string, jest.Mock>;
  let slippageContextService: Record<string, jest.Mock>;
  let metricsCalculator: Record<string, jest.Mock>;

  const baseConfig: OptimizationBacktestConfig = {
    algorithmId: 'rsi-momentum-001',
    parameters: {},
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-01-31'),
    initialCapital: 10000
  };

  beforeEach(async () => {
    ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue([]) };
    priceWindowService = {
      groupPricesByTimestamp: jest.fn().mockReturnValue({}),
      initPriceTracking: jest.fn().mockReturnValue({
        indexByCoin: new Map(),
        windowsByCoin: new Map(),
        summariesByCoin: new Map()
      }),
      initPriceTrackingFromPrecomputed: jest.fn().mockReturnValue({
        indexByCoin: new Map(),
        windowsByCoin: new Map(),
        summariesByCoin: new Map()
      }),
      clearPriceData: jest.fn(),
      extractCandleSegments: jest.fn().mockReturnValue([]),
      advancePriceWindows: jest.fn().mockReturnValue(new Map()),
      getPriceValue: jest.fn().mockImplementation((c: OHLCCandle) => c.close),
      precomputeWindowData: jest.fn(),
      filterCoinsWithSufficientData: jest.fn().mockResolvedValue({ filtered: [], excludedCount: 0 })
    };
    portfolioState = {
      updateValues: jest.fn().mockImplementation((p) => p)
    };
    metricsCalculator = {
      calculateSharpeRatio: jest.fn().mockReturnValue(0)
    };
    algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({ success: true, signals: [] })
    };
    exitSignalProcessor = {
      resolveExitTracker: jest.fn().mockReturnValue(null),
      processExitSignals: jest.fn()
    };
    compositeRegimeService = {
      resolveRegimeConfigForOptimization: jest.fn().mockReturnValue({
        enableRegimeScaledSizing: false,
        riskLevel: 3,
        regimeGateEnabled: false,
        btcCoin: null
      }),
      computeCompositeRegime: jest.fn(),
      applyBarRegime: jest.fn()
    };
    signalThrottle = {
      resolveConfig: jest.fn().mockReturnValue({}),
      createState: jest.fn().mockReturnValue({}),
      filterSignals: jest.fn().mockReturnValue({ accepted: [], rejected: [] })
    };
    indicatorPrecompute = {
      precomputeIndicatorsForOptimization: jest.fn().mockResolvedValue(undefined)
    };
    tradeExecutor = {
      executeTrade: jest.fn()
    };
    slippageContextService = {
      extractDailyVolume: jest.fn(),
      buildSpreadContext: jest.fn(),
      updatePrevCandleMap: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OptimizationCoreService,
        { provide: PortfolioStateService, useValue: portfolioState },
        { provide: MetricsCalculatorService, useValue: metricsCalculator },
        { provide: AlgorithmRegistry, useValue: algorithmRegistry },
        { provide: PriceWindowService, useValue: priceWindowService },
        { provide: ExitSignalProcessorService, useValue: exitSignalProcessor },
        { provide: CompositeRegimeService, useValue: compositeRegimeService },
        { provide: SlippageContextService, useValue: slippageContextService },
        { provide: SignalThrottleService, useValue: signalThrottle },
        { provide: OptimizationIndicatorPrecomputeService, useValue: indicatorPrecompute },
        { provide: TradeExecutorService, useValue: tradeExecutor },
        { provide: OHLCService, useValue: ohlcService }
      ]
    }).compile();

    service = module.get(OptimizationCoreService);
  });

  describe('runOptimizationBacktestCore', () => {
    it('should return EMPTY_RESULT when historicalPrices is empty', async () => {
      const result = await service.runOptimizationBacktestCore({
        config: baseConfig,
        coins: [],
        historicalPrices: [],
        executeTradeFn: jest.fn()
      });

      expect(result).toEqual({
        sharpeRatio: 0,
        totalReturn: 0,
        maxDrawdown: 0,
        winRate: 0,
        volatility: 0,
        profitFactor: 1,
        tradeCount: 0
      });
    });

    it('should process candles and return metrics for valid price data', async () => {
      const ts = '2024-01-15T00:00:00.000Z';
      const candle = {
        coinId: 'coin-1',
        close: 100,
        open: 99,
        high: 101,
        low: 98,
        volume: 1000,
        quoteVolume: 100000,
        timestamp: new Date(ts)
      } as OHLCCandle;

      priceWindowService.groupPricesByTimestamp.mockReturnValue({ [ts]: [candle] });
      priceWindowService.initPriceTracking.mockReturnValue({
        indexByCoin: new Map(),
        windowsByCoin: new Map(),
        summariesByCoin: new Map()
      });
      metricsCalculator.calculateSharpeRatio.mockReturnValue(1.5);

      const result = await service.runOptimizationBacktestCore({
        config: baseConfig,
        coins: [{ id: 'coin-1' } as any],
        historicalPrices: [candle],
        executeTradeFn: jest.fn()
      });

      expect(priceWindowService.groupPricesByTimestamp).toHaveBeenCalledWith([candle]);
      expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledWith(
        'rsi-momentum-001',
        expect.objectContaining({ timestamp: new Date(ts) })
      );
      expect(result.tradeCount).toBe(0);
      expect(result.totalReturn).toBe(0);
      expect(priceWindowService.clearPriceData).toHaveBeenCalled();
    });

    it('should rethrow AlgorithmNotRegisteredException', async () => {
      const ts = '2024-01-15T00:00:00.000Z';
      const candle = { coinId: 'coin-1', close: 100, volume: 1000 } as OHLCCandle;

      priceWindowService.groupPricesByTimestamp.mockReturnValue({ [ts]: [candle] });
      algorithmRegistry.executeAlgorithm.mockRejectedValue(new AlgorithmNotRegisteredException('unknown-algo'));

      await expect(
        service.runOptimizationBacktestCore({
          config: baseConfig,
          coins: [{ id: 'coin-1' } as any],
          historicalPrices: [candle],
          executeTradeFn: jest.fn()
        })
      ).rejects.toThrow(AlgorithmNotRegisteredException);
    });

    it('should continue processing when algorithm throws a non-fatal error', async () => {
      const ts1 = '2024-01-15T00:00:00.000Z';
      const ts2 = '2024-01-16T00:00:00.000Z';
      const candle1 = { coinId: 'coin-1', close: 100, volume: 1000 } as OHLCCandle;
      const candle2 = { coinId: 'coin-1', close: 105, volume: 1100 } as OHLCCandle;

      priceWindowService.groupPricesByTimestamp.mockReturnValue({
        [ts1]: [candle1],
        [ts2]: [candle2]
      });

      algorithmRegistry.executeAlgorithm
        .mockRejectedValueOnce(new Error('Transient failure'))
        .mockResolvedValueOnce({ success: true, signals: [] });

      const result = await service.runOptimizationBacktestCore({
        config: baseConfig,
        coins: [{ id: 'coin-1' } as any],
        historicalPrices: [candle1, candle2],
        executeTradeFn: jest.fn()
      });

      expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledTimes(2);
      expect(result).toBeDefined();
    });

    it('should build volume map with quoteVolume fallback to volume * close', async () => {
      const ts = '2024-01-15T00:00:00.000Z';
      const candleWithQuoteVol = {
        coinId: 'coin-1',
        close: 100,
        volume: 500,
        quoteVolume: 55000
      } as OHLCCandle;
      const candleWithoutQuoteVol = {
        coinId: 'coin-2',
        close: 200,
        volume: 300,
        quoteVolume: undefined as unknown as number
      } as OHLCCandle;

      priceWindowService.groupPricesByTimestamp.mockReturnValue({
        [ts]: [candleWithQuoteVol, candleWithoutQuoteVol]
      });

      // Execute a BUY signal to verify the volume map is passed to executeTradeFn
      algorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [{ action: 'BUY', coinId: 'coin-1', strength: 0.8 }]
      });
      signalThrottle.filterSignals.mockReturnValue({
        accepted: [{ action: 'BUY', coinId: 'coin-1', strength: 0.8 }],
        rejected: []
      });

      const executeTradeFn = jest.fn().mockResolvedValue(null);

      await service.runOptimizationBacktestCore({
        config: baseConfig,
        coins: [{ id: 'coin-1' } as any, { id: 'coin-2' } as any],
        historicalPrices: [candleWithQuoteVol, candleWithoutQuoteVol],
        executeTradeFn
      });

      // The executeTradeFn should receive the quoteVolume (55000) as dailyVolume in the params object
      expect(executeTradeFn).toHaveBeenCalled();
      const params = executeTradeFn.mock.calls[0][0];
      expect(params.signal).toEqual(expect.objectContaining({ coinId: 'coin-1' }));
      expect(params.dailyVolume).toBe(55000); // dailyVolume from volumeMap using quoteVolume
    });
  });

  describe('executeOptimizationBacktest', () => {
    it('should fetch candles from OHLC service and delegate to core', async () => {
      const coins = [{ id: 'coin-1' } as any];
      ohlcService.getCandlesByDateRange.mockResolvedValue([]);

      const result = await service.executeOptimizationBacktest(baseConfig, coins);

      expect(ohlcService.getCandlesByDateRange).toHaveBeenCalledWith(
        ['coin-1'],
        baseConfig.startDate,
        baseConfig.endDate
      );
      expect(result.tradeCount).toBe(0);
    });
  });

  describe('executeOptimizationBacktestWithData', () => {
    it('should extract candle segments and delegate to core', async () => {
      const coins = [{ id: 'coin-1' } as any];
      const preloaded = new Map<string, OHLCCandle[]>();

      priceWindowService.extractCandleSegments.mockReturnValue([]);

      const result = await service.executeOptimizationBacktestWithData(baseConfig, coins, preloaded);

      expect(priceWindowService.extractCandleSegments).toHaveBeenCalledWith(
        coins,
        preloaded,
        baseConfig.startDate.getTime(),
        baseConfig.endDate.getTime()
      );
      expect(result.tradeCount).toBe(0);
    });
  });

  describe('runOptimizationBacktestWithPrecomputed', () => {
    it('should return EMPTY_RESULT when filteredCandles is empty', async () => {
      const precomputed = {
        pricesByTimestamp: {},
        timestamps: [],
        immutablePriceData: { timestampsByCoin: new Map(), summariesByCoin: new Map() },
        volumeMap: new Map(),
        filteredCandles: [],
        tradingStartIndex: 0
      };

      const result = await service.runOptimizationBacktestWithPrecomputed(baseConfig, [], precomputed);

      expect(result).toEqual({
        sharpeRatio: 0,
        totalReturn: 0,
        maxDrawdown: 0,
        winRate: 0,
        volatility: 0,
        profitFactor: 1,
        tradeCount: 0
      });
      // Should not attempt to initialize price tracking
      expect(priceWindowService.initPriceTrackingFromPrecomputed).not.toHaveBeenCalled();
    });

    it('should filter coins with insufficient data and run simulation', async () => {
      const ts = '2024-01-15T00:00:00.000Z';
      const candle = { coinId: 'coin-1', close: 100, volume: 500 } as OHLCCandle;
      const coins = [{ id: 'coin-1' } as any];

      const precomputed = {
        pricesByTimestamp: { [ts]: [candle] },
        timestamps: [ts],
        immutablePriceData: { timestampsByCoin: new Map(), summariesByCoin: new Map() },
        volumeMap: new Map(),
        filteredCandles: [candle],
        tradingStartIndex: 0
      };

      priceWindowService.filterCoinsWithSufficientData.mockResolvedValue({
        filtered: coins,
        excludedCount: 0
      });

      const result = await service.runOptimizationBacktestWithPrecomputed(baseConfig, coins, precomputed);

      expect(priceWindowService.filterCoinsWithSufficientData).toHaveBeenCalled();
      expect(indicatorPrecompute.precomputeIndicatorsForOptimization).toHaveBeenCalled();
      expect(result.tradeCount).toBe(0);
    });
  });

  describe('precomputeWindowData', () => {
    it('should delegate to PriceWindowService', () => {
      const coins = [{ id: 'coin-1' } as any];
      const preloaded = new Map<string, OHLCCandle[]>();
      const start = new Date('2024-01-01');
      const end = new Date('2024-01-31');
      const expected = {
        pricesByTimestamp: {},
        timestamps: [],
        immutablePriceData: {} as any,
        volumeMap: new Map(),
        filteredCandles: [],
        tradingStartIndex: 0
      };

      priceWindowService.precomputeWindowData.mockReturnValue(expected);

      const result = service.precomputeWindowData(coins, preloaded, start, end);

      expect(priceWindowService.precomputeWindowData).toHaveBeenCalledWith(coins, preloaded, start, end);
      expect(result).toBe(expected);
    });
  });

  describe('simulation loop behavior', () => {
    it('should track drawdown correctly across multiple bars', async () => {
      const ts1 = '2024-01-15T00:00:00.000Z';
      const ts2 = '2024-01-16T00:00:00.000Z';
      const ts3 = '2024-01-17T00:00:00.000Z';
      const candle1 = { coinId: 'coin-1', close: 100, volume: 1000 } as OHLCCandle;
      const candle2 = { coinId: 'coin-1', close: 100, volume: 1000 } as OHLCCandle;
      const candle3 = { coinId: 'coin-1', close: 100, volume: 1000 } as OHLCCandle;

      priceWindowService.groupPricesByTimestamp.mockReturnValue({
        [ts1]: [candle1],
        [ts2]: [candle2],
        [ts3]: [candle3]
      });

      // Simulate portfolio value dropping then recovering
      let callCount = 0;
      portfolioState.updateValues.mockImplementation((p) => {
        callCount++;
        if (callCount === 2) {
          return { ...p, totalValue: 8000 }; // 20% drawdown from peak 10000
        }
        return { ...p, totalValue: 10000 };
      });

      const result = await service.runOptimizationBacktestCore({
        config: baseConfig,
        coins: [{ id: 'coin-1' } as any],
        historicalPrices: [candle1, candle2, candle3],
        executeTradeFn: jest.fn()
      });

      expect(result.maxDrawdown).toBeCloseTo(0.2, 5);
    });

    it('should skip trading logic during warm-up period when tradingStartIndex > 0', async () => {
      const ts1 = '2024-01-15T00:00:00.000Z';
      const ts2 = '2024-01-16T00:00:00.000Z';
      const candle1 = { coinId: 'coin-1', close: 100, volume: 500 } as OHLCCandle;
      const candle2 = { coinId: 'coin-1', close: 105, volume: 600 } as OHLCCandle;
      const coins = [{ id: 'coin-1' } as any];

      const precomputed = {
        pricesByTimestamp: { [ts1]: [candle1], [ts2]: [candle2] },
        timestamps: [ts1, ts2],
        immutablePriceData: { timestampsByCoin: new Map(), summariesByCoin: new Map() },
        volumeMap: new Map(),
        filteredCandles: [candle1, candle2],
        tradingStartIndex: 1 // Skip first bar
      };

      priceWindowService.filterCoinsWithSufficientData.mockResolvedValue({
        filtered: coins,
        excludedCount: 0
      });

      await service.runOptimizationBacktestWithPrecomputed(baseConfig, coins, precomputed);

      // Algorithm should only execute for bar at index 1 (after warm-up)
      expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledTimes(1);
      expect(slippageContextService.updatePrevCandleMap).toHaveBeenCalledTimes(2);
    });
  });
});
