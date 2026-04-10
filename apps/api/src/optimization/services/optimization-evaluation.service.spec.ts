import { type Repository, type SelectQueryBuilder } from 'typeorm';

import { type WindowMetrics } from '@chansey/api-interfaces';

import { OptimizationEvaluationService } from './optimization-evaluation.service';

import { type Coin } from '../../coin/coin.entity';
import { type OHLCCandle } from '../../ohlc/ohlc-candle.entity';
import { type OHLCService } from '../../ohlc/ohlc.service';
import { type BacktestEngine } from '../../order/backtest/backtest-engine.service';
import { type PrecomputedWindowData } from '../../order/backtest/shared';
import { type WalkForwardService, type WalkForwardWindowConfig } from '../../scoring/walk-forward/walk-forward.service';
import { type WindowProcessor } from '../../scoring/walk-forward/window-processor';
import { type OptimizationConfig } from '../interfaces';

describe('OptimizationEvaluationService', () => {
  let service: OptimizationEvaluationService;
  let coinRepo: jest.Mocked<Repository<Coin>>;
  let backtestEngine: jest.Mocked<BacktestEngine>;
  let windowProcessor: jest.Mocked<WindowProcessor>;
  let ohlcService: jest.Mocked<OHLCService>;
  let walkForwardService: jest.Mocked<WalkForwardService>;

  // --- Shared factories ---

  const createMockMetrics = (overrides: Partial<WindowMetrics> = {}): WindowMetrics => ({
    sharpeRatio: 1.5,
    totalReturn: 0.1,
    maxDrawdown: -0.05,
    winRate: 0.6,
    tradeCount: 50,
    profitFactor: 2.0,
    volatility: 0.2,
    downsideDeviation: 0.1,
    ...overrides
  });

  const createWindow = (
    index: number,
    trainStart: string,
    trainEnd: string,
    testStart: string,
    testEnd: string
  ): WalkForwardWindowConfig =>
    ({
      windowIndex: index,
      trainStartDate: new Date(trainStart),
      trainEndDate: new Date(trainEnd),
      testStartDate: new Date(testStart),
      testEndDate: new Date(testEnd)
    }) as WalkForwardWindowConfig;

  const createValidConfig = (overrides: Partial<OptimizationConfig> = {}): OptimizationConfig =>
    ({
      method: 'grid_search',
      walkForward: { trainDays: 90, testDays: 30, stepDays: 15, method: 'rolling', minWindowsRequired: 3 },
      objective: { metric: 'sharpe_ratio', minimize: false },
      parallelism: { maxConcurrentBacktests: 3, maxConcurrentWindows: 3 },
      ...overrides
    }) as OptimizationConfig;

  const createPrecomputedData = (): PrecomputedWindowData =>
    ({
      filteredCandles: [],
      timestamps: [],
      pricesByTimestamp: {},
      immutablePriceData: {},
      volumeMap: new Map(),
      tradingStartIndex: 0
    }) as unknown as PrecomputedWindowData;

  const createMockQueryBuilder = (result: Coin[] = []) => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(result)
    } as unknown as jest.Mocked<SelectQueryBuilder<Coin>>;
    coinRepo.createQueryBuilder.mockReturnValue(qb);
    return qb;
  };

  beforeEach(() => {
    coinRepo = {
      createQueryBuilder: jest.fn()
    } as unknown as jest.Mocked<Repository<Coin>>;

    backtestEngine = {
      executeOptimizationBacktest: jest.fn(),
      executeOptimizationBacktestWithData: jest.fn(),
      precomputeWindowData: jest.fn(),
      runOptimizationBacktestWithPrecomputed: jest.fn()
    } as unknown as jest.Mocked<BacktestEngine>;

    windowProcessor = {
      processWindow: jest.fn()
    } as unknown as jest.Mocked<WindowProcessor>;

    ohlcService = {
      getCandlesByDateRange: jest.fn().mockResolvedValue([]),
      getCandleDataDateRange: jest.fn().mockResolvedValue({
        start: new Date('2025-11-10'),
        end: new Date('2026-02-20')
      })
    } as unknown as jest.Mocked<OHLCService>;

    walkForwardService = {
      generateWindows: jest.fn()
    } as unknown as jest.Mocked<WalkForwardService>;

    service = new OptimizationEvaluationService(
      coinRepo,
      backtestEngine,
      windowProcessor,
      ohlcService,
      walkForwardService
    );
  });

  describe('evaluateCombination', () => {
    const defaultWindow = createWindow(0, '2024-01-01', '2024-04-01', '2024-04-01', '2024-05-01');
    const coins = [{ id: 'btc' }] as Coin[];

    const buildEvalParams = (overrides: Record<string, unknown> = {}) => ({
      strategyConfig: { id: 'strategy-1', algorithmId: 'algo-1' },
      parameters: { period: 14 },
      windows: [defaultWindow],
      config: createValidConfig(),
      coins,
      preloadedCandlesByCoin: new Map<string, OHLCCandle[]>([['btc', []]]),
      ...overrides
    });

    it('should run train and test backtests in parallel per window', async () => {
      const callOrder: string[] = [];
      backtestEngine.executeOptimizationBacktestWithData.mockImplementation(async (cfg) => {
        const label = cfg.startDate.getTime() === defaultWindow.trainStartDate.getTime() ? 'train' : 'test';
        callOrder.push(`${label}-start`);
        await new Promise((r) => setTimeout(r, 10));
        callOrder.push(`${label}-end`);
        return createMockMetrics();
      });
      windowProcessor.processWindow.mockReturnValue({ degradation: 0.05, overfittingDetected: false } as any);

      const result = await service.evaluateCombination(buildEvalParams());

      expect(result.windowResults).toHaveLength(1);
      // Both backtests should start before either finishes (parallel)
      expect(callOrder[0]).toContain('start');
      expect(callOrder[1]).toContain('start');
      expect(backtestEngine.executeOptimizationBacktestWithData).toHaveBeenCalledTimes(2);
    });

    it('should use pre-computed fast path when precomputedWindows are provided', async () => {
      backtestEngine.runOptimizationBacktestWithPrecomputed.mockResolvedValue(createMockMetrics());
      windowProcessor.processWindow.mockReturnValue({ degradation: 0.05, overfittingDetected: false } as any);

      const precomputedWindows = new Map<string, PrecomputedWindowData>();
      const trainKey = `${defaultWindow.trainStartDate.getTime()}-${defaultWindow.trainEndDate.getTime()}`;
      const testKey = `${defaultWindow.testStartDate.getTime()}-${defaultWindow.testEndDate.getTime()}`;
      precomputedWindows.set(trainKey, createPrecomputedData());
      precomputedWindows.set(testKey, createPrecomputedData());

      const result = await service.evaluateCombination(buildEvalParams({ precomputedWindows }));

      expect(result.windowResults).toHaveLength(1);
      expect(backtestEngine.runOptimizationBacktestWithPrecomputed).toHaveBeenCalledTimes(2);
      expect(backtestEngine.executeOptimizationBacktestWithData).not.toHaveBeenCalled();
      expect(backtestEngine.executeOptimizationBacktest).not.toHaveBeenCalled();
    });

    it('should fall back to bare executeOptimizationBacktest when no candles or precomputed data', async () => {
      backtestEngine.executeOptimizationBacktest.mockResolvedValue(createMockMetrics());
      windowProcessor.processWindow.mockReturnValue({ degradation: 0.05, overfittingDetected: false } as any);

      const result = await service.evaluateCombination(
        buildEvalParams({ preloadedCandlesByCoin: undefined, precomputedWindows: undefined })
      );

      expect(result.windowResults).toHaveLength(1);
      expect(backtestEngine.executeOptimizationBacktest).toHaveBeenCalledTimes(2);
      expect(backtestEngine.runOptimizationBacktestWithPrecomputed).not.toHaveBeenCalled();
      expect(backtestEngine.executeOptimizationBacktestWithData).not.toHaveBeenCalled();
    });

    it('should correctly average scores and track overfitting across multiple windows', async () => {
      const window2 = createWindow(1, '2024-04-01', '2024-07-01', '2024-07-01', '2024-08-01');
      backtestEngine.executeOptimizationBacktestWithData.mockResolvedValue(createMockMetrics({ sharpeRatio: 2.0 }));
      windowProcessor.processWindow
        .mockReturnValueOnce({ degradation: 0.1, overfittingDetected: false } as any)
        .mockReturnValueOnce({ degradation: 0.4, overfittingDetected: true } as any);

      const result = await service.evaluateCombination(buildEvalParams({ windows: [defaultWindow, window2] }));

      expect(result.windowResults).toHaveLength(2);
      expect(result.overfittingWindows).toBe(1);
      expect(result.avgDegradation).toBeCloseTo(0.25); // (0.1 + 0.4) / 2
      expect(result.consistencyScore).toBeGreaterThanOrEqual(0);
      expect(result.consistencyScore).toBeLessThanOrEqual(100);
    });

    it('should invoke heartbeat callback for each window', async () => {
      backtestEngine.executeOptimizationBacktestWithData.mockResolvedValue(createMockMetrics());
      windowProcessor.processWindow.mockReturnValue({ degradation: 0.05, overfittingDetected: false } as any);
      const heartbeatFn = jest.fn().mockResolvedValue(undefined);

      await service.evaluateCombination(buildEvalParams({ heartbeatFn }));

      expect(heartbeatFn).toHaveBeenCalledTimes(1);
    });

    it('should wrap backtest errors with date range context', async () => {
      backtestEngine.executeOptimizationBacktestWithData.mockRejectedValue(new Error('out of memory'));
      windowProcessor.processWindow.mockReturnValue({ degradation: 0, overfittingDetected: false } as any);

      await expect(service.evaluateCombination(buildEvalParams())).rejects.toThrow(
        /Backtest failed for.*out of memory/
      );
    });
  });

  describe('loadCoinsForOptimization', () => {
    it('should throw when no coins available from primary or fallback', async () => {
      createMockQueryBuilder([]);

      await expect(service.loadCoinsForOptimization(20)).rejects.toThrow('No coins');
    });

    it('should return coins ranked by market cap', async () => {
      const mockCoins = [{ id: 'btc' }, { id: 'eth' }] as Coin[];
      const qb = createMockQueryBuilder(mockCoins);

      const result = await service.loadCoinsForOptimization(20);

      expect(result).toHaveLength(2);
      expect(qb.orderBy).toHaveBeenCalledWith('coin.marketRank', 'ASC');
    });

    it('should fall back to coins without market rank when primary returns empty', async () => {
      const mockCoins = [{ id: 'sol' }] as Coin[];
      // First call (primary) returns empty, second call (fallback) returns coins
      const qb = createMockQueryBuilder([]);
      qb.getMany.mockResolvedValueOnce([]).mockResolvedValueOnce(mockCoins);

      const result = await service.loadCoinsForOptimization(20);

      expect(result).toEqual(mockCoins);
      // createQueryBuilder called twice (primary + fallback)
      expect(coinRepo.createQueryBuilder).toHaveBeenCalledTimes(2);
    });

    it('should include minDataDays span condition when provided', async () => {
      const qb = createMockQueryBuilder([{ id: 'btc' }] as Coin[]);

      await service.loadCoinsForOptimization(20, 90);

      // andWhere called for marketRank + minDataDays span (2 andWhere calls)
      expect(qb.andWhere).toHaveBeenCalledTimes(2);
      expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('EXTRACT(EPOCH'), { minDataDays: 90 });
    });
  });

  describe('loadAndIndexCandles', () => {
    it('should build coin-indexed map from raw candles', async () => {
      const mockCandles = [
        { coinId: 'btc', timestamp: new Date('2024-01-01') },
        { coinId: 'btc', timestamp: new Date('2024-01-02') },
        { coinId: 'eth', timestamp: new Date('2024-01-01') }
      ];
      ohlcService.getCandlesByDateRange.mockResolvedValue(mockCandles as any);

      const result = await service.loadAndIndexCandles(
        ['btc', 'eth'],
        new Date('2024-01-01'),
        new Date('2024-01-02'),
        'run-1'
      );

      expect(result.allCandleCount).toBe(3);
      expect(result.candlesByCoin.get('btc')).toHaveLength(2);
      expect(result.candlesByCoin.get('eth')).toHaveLength(1);
    });
  });

  describe('precomputeAllWindowData', () => {
    it('should deduplicate overlapping date ranges across windows', () => {
      // Two windows sharing the same test range
      const window1 = createWindow(0, '2024-01-01', '2024-04-01', '2024-04-01', '2024-05-01');
      const window2 = createWindow(1, '2024-02-01', '2024-05-01', '2024-04-01', '2024-05-01');
      const coins = [{ id: 'btc' }] as Coin[];
      const candlesByCoin = new Map<string, OHLCCandle[]>([['btc', []]]);
      backtestEngine.precomputeWindowData.mockReturnValue(createPrecomputedData());

      const result = service.precomputeAllWindowData(
        [window1, window2],
        coins,
        candlesByCoin,
        14,
        new Date('2023-12-01'),
        'run-1'
      );

      // 2 windows × 2 ranges = 4, but test range is shared → 3 unique
      expect(result.size).toBe(3);
      expect(backtestEngine.precomputeWindowData).toHaveBeenCalledTimes(3);
    });
  });

  describe('getDateRange', () => {
    it('should use config dateRange when provided', async () => {
      const config = {
        dateRange: { startDate: new Date('2024-01-01'), endDate: new Date('2024-06-01') }
      } as any;

      const result = await service.getDateRange(config);

      expect(result.startDate).toEqual(new Date('2024-01-01'));
      expect(result.endDate).toEqual(new Date('2024-06-01'));
      expect(ohlcService.getCandleDataDateRange).not.toHaveBeenCalled();
    });

    it('should query OHLC data bounds when no dateRange in config', async () => {
      const result = await service.getDateRange({} as any);

      expect(result.startDate).toEqual(new Date('2025-11-10'));
      expect(result.endDate).toEqual(new Date('2026-02-20'));
      expect(ohlcService.getCandleDataDateRange).toHaveBeenCalled();
    });

    it('should fall back to 3-month range when no OHLC data exists', async () => {
      ohlcService.getCandleDataDateRange.mockResolvedValue(null);

      const result = await service.getDateRange({} as any);

      expect(result.startDate).toBeInstanceOf(Date);
      expect(result.endDate).toBeInstanceOf(Date);
      // Roughly 3 months apart (allow ±5 days for month length variance)
      const diffDays = (result.endDate.getTime() - result.startDate.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(80);
      expect(diffDays).toBeLessThan(100);
    });
  });

  describe('prepareWalkForwardData', () => {
    const buildPrepareParams = (overrides: Record<string, unknown> = {}) => ({
      config: createValidConfig({
        walkForward: { trainDays: 90, testDays: 30, stepDays: 15, method: 'rolling', minWindowsRequired: 1 }
      } as any),
      parameterSpace: { strategyType: 'test', parameters: [] },
      coins: [{ id: 'btc' }] as any[],
      runId: 'run-1',
      dateRange: { startDate: new Date('2024-01-01'), endDate: new Date('2024-06-01') },
      ...overrides
    });

    it('should generate windows, load candles, and precompute data', async () => {
      const windows = [createWindow(0, '2024-01-01', '2024-04-01', '2024-04-01', '2024-05-01')];
      walkForwardService.generateWindows.mockReturnValue(windows);
      ohlcService.getCandlesByDateRange.mockResolvedValue([]);
      backtestEngine.precomputeWindowData.mockReturnValue(createPrecomputedData());

      const result = await service.prepareWalkForwardData(buildPrepareParams());

      expect(result.windows).toBe(windows);
      expect(walkForwardService.generateWindows).toHaveBeenCalled();
      expect(result.candlesByCoin).toBeInstanceOf(Map);
      expect(result.precomputedWindows).toBeInstanceOf(Map);
      expect(result.warmupDays).toBeGreaterThanOrEqual(0);
    });

    it('should throw when insufficient windows generated', async () => {
      walkForwardService.generateWindows.mockReturnValue([]);

      await expect(
        service.prepareWalkForwardData(
          buildPrepareParams({
            config: createValidConfig({
              walkForward: { trainDays: 90, testDays: 30, stepDays: 15, method: 'rolling', minWindowsRequired: 3 }
            } as any)
          })
        )
      ).rejects.toThrow('Insufficient windows');
    });

    it('should extend minDate backward by warmupDays for candle loading', async () => {
      const windows = [createWindow(0, '2024-01-01', '2024-04-01', '2024-04-01', '2024-05-01')];
      walkForwardService.generateWindows.mockReturnValue(windows);
      ohlcService.getCandlesByDateRange.mockResolvedValue([]);
      backtestEngine.precomputeWindowData.mockReturnValue(createPrecomputedData());

      await service.prepareWalkForwardData(buildPrepareParams());

      // Verify that the extended min date passed to getCandlesByDateRange is before the train start
      const candleCallArgs = ohlcService.getCandlesByDateRange.mock.calls[0];
      const extendedMinDate = candleCallArgs[1] as Date;
      expect(extendedMinDate.getTime()).toBeLessThan(new Date('2024-01-01').getTime());
    });
  });

  describe('evaluateCombination — windowResults structure', () => {
    const defaultWindow = createWindow(0, '2024-01-01', '2024-04-01', '2024-04-01', '2024-05-01');
    const coins = [{ id: 'btc' }] as Coin[];

    it('should populate windowResults with correct date strings and index', async () => {
      backtestEngine.executeOptimizationBacktestWithData.mockResolvedValue(createMockMetrics());
      windowProcessor.processWindow.mockResolvedValue({ degradation: 0.1, overfittingDetected: false } as any);

      const result = await service.evaluateCombination({
        strategyConfig: { id: 'strategy-1', algorithmId: 'algo-1' },
        parameters: { period: 14 },
        windows: [defaultWindow],
        config: createValidConfig(),
        coins,
        preloadedCandlesByCoin: new Map<string, OHLCCandle[]>([['btc', []]])
      });

      expect(result.windowResults[0]).toEqual(
        expect.objectContaining({
          windowIndex: 0,
          trainStartDate: '2024-01-01',
          trainEndDate: '2024-04-01',
          testStartDate: '2024-04-01',
          testEndDate: '2024-05-01',
          overfitting: false
        })
      );
      expect(typeof result.windowResults[0].trainScore).toBe('number');
      expect(typeof result.windowResults[0].testScore).toBe('number');
    });
  });
});
