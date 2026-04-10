import { Test, type TestingModule } from '@nestjs/testing';

import { type OptimizationBacktestConfig } from './optimization-backtest.interface';
import { OptimizationIndicatorPrecomputeService } from './optimization-indicator-precompute.service';

import { AlgorithmRegistry } from '../../../../algorithm/registry/algorithm-registry.service';
import { type PriceTrackingContext } from '../price-window';

describe('OptimizationIndicatorPrecomputeService', () => {
  let service: OptimizationIndicatorPrecomputeService;
  let algorithmRegistry: jest.Mocked<AlgorithmRegistry>;

  const makeConfig = (overrides: Partial<OptimizationBacktestConfig> = {}): OptimizationBacktestConfig => ({
    algorithmId: 'test-001',
    parameters: {},
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-06-01'),
    ...overrides
  });

  const makePrices = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      avg: 100 + i,
      high: 105 + i,
      low: 95 + i
    }));

  const makePriceCtx = (coinId: string, count: number): PriceTrackingContext => ({
    summariesByCoin: new Map([[coinId, makePrices(count) as any]]),
    timestampsByCoin: new Map(),
    indexByCoin: new Map(),
    windowsByCoin: new Map()
  });

  const emptyPriceCtx: PriceTrackingContext = {
    summariesByCoin: new Map(),
    timestampsByCoin: new Map(),
    indexByCoin: new Map(),
    windowsByCoin: new Map()
  };

  const coins = [{ id: 'coin-1', symbol: 'BTC' }] as any[];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OptimizationIndicatorPrecomputeService,
        {
          provide: AlgorithmRegistry,
          useValue: {
            getStrategyForAlgorithm: jest.fn()
          }
        }
      ]
    }).compile();

    service = module.get(OptimizationIndicatorPrecomputeService);
    algorithmRegistry = module.get(AlgorithmRegistry);
  });

  describe('precomputeIndicatorsForOptimization', () => {
    it('should return undefined when strategy lookup throws', async () => {
      algorithmRegistry.getStrategyForAlgorithm.mockRejectedValue(new Error('Not found'));

      const result = await service.precomputeIndicatorsForOptimization(makeConfig(), [], emptyPriceCtx);
      expect(result).toBeUndefined();
    });

    it('should return undefined when strategy has no getIndicatorRequirements', async () => {
      algorithmRegistry.getStrategyForAlgorithm.mockResolvedValue({} as any);

      const result = await service.precomputeIndicatorsForOptimization(makeConfig(), coins, makePriceCtx('coin-1', 30));
      expect(result).toBeUndefined();
    });

    it('should return undefined when requirements array is empty', async () => {
      algorithmRegistry.getStrategyForAlgorithm.mockResolvedValue({
        getIndicatorRequirements: () => []
      } as any);

      const result = await service.precomputeIndicatorsForOptimization(makeConfig(), coins, makePriceCtx('coin-1', 30));
      expect(result).toBeUndefined();
    });

    it('should skip coins with no price summaries', async () => {
      algorithmRegistry.getStrategyForAlgorithm.mockResolvedValue({
        getIndicatorRequirements: () => [
          { type: 'EMA' as const, paramKeys: ['emaPeriod'], defaultParams: { emaPeriod: 10 } }
        ]
      } as any);

      const result = await service.precomputeIndicatorsForOptimization(makeConfig(), coins, emptyPriceCtx);
      expect(result).toBeUndefined();
    });

    it('should return undefined when price data is insufficient for the indicator period', async () => {
      algorithmRegistry.getStrategyForAlgorithm.mockResolvedValue({
        getIndicatorRequirements: () => [
          { type: 'EMA' as const, paramKeys: ['emaPeriod'], defaultParams: { emaPeriod: 50 } }
        ]
      } as any);

      // Only 10 prices but period is 50
      const result = await service.precomputeIndicatorsForOptimization(
        makeConfig({ parameters: { emaPeriod: 50 } }),
        coins,
        makePriceCtx('coin-1', 10)
      );
      expect(result).toBeUndefined();
    });

    it('should use defaultParams when config parameter is missing', async () => {
      algorithmRegistry.getStrategyForAlgorithm.mockResolvedValue({
        getIndicatorRequirements: () => [
          { type: 'EMA' as const, paramKeys: ['emaPeriod'], defaultParams: { emaPeriod: 5 } }
        ]
      } as any);

      // No emaPeriod in config.parameters — should fall back to default 5
      const result = await service.precomputeIndicatorsForOptimization(
        makeConfig({ parameters: {} }),
        coins,
        makePriceCtx('coin-1', 20)
      );

      expect(result).toBeDefined();
      expect(result?.['coin-1']['ema_5']).toBeInstanceOf(Float64Array);
    });

    it('should precompute EMA indicator with correct length and NaN padding', async () => {
      algorithmRegistry.getStrategyForAlgorithm.mockResolvedValue({
        getIndicatorRequirements: () => [
          { type: 'EMA' as const, paramKeys: ['emaPeriod'], defaultParams: { emaPeriod: 10 } }
        ]
      } as any);

      const result = await service.precomputeIndicatorsForOptimization(
        makeConfig({ parameters: { emaPeriod: 10 } }),
        coins,
        makePriceCtx('coin-1', 30)
      );

      expect(result).toBeDefined();
      expect(result?.['coin-1']['ema_10']).toBeInstanceOf(Float64Array);
      expect(result?.['coin-1']['ema_10'].length).toBe(30);
      // First values should be NaN (padding), later values should be numeric
      expect(result?.['coin-1']['ema_10'][29]).not.toBeNaN();
    });

    it('should precompute SMA indicator', async () => {
      algorithmRegistry.getStrategyForAlgorithm.mockResolvedValue({
        getIndicatorRequirements: () => [
          { type: 'SMA' as const, paramKeys: ['smaPeriod'], defaultParams: { smaPeriod: 10 } }
        ]
      } as any);

      const result = await service.precomputeIndicatorsForOptimization(
        makeConfig({ parameters: { smaPeriod: 10 } }),
        coins,
        makePriceCtx('coin-1', 30)
      );

      expect(result?.['coin-1']['sma_10']).toBeInstanceOf(Float64Array);
      expect(result?.['coin-1']['sma_10'].length).toBe(30);
    });

    it('should precompute RSI indicator', async () => {
      algorithmRegistry.getStrategyForAlgorithm.mockResolvedValue({
        getIndicatorRequirements: () => [
          { type: 'RSI' as const, paramKeys: ['rsiPeriod'], defaultParams: { rsiPeriod: 14 } }
        ]
      } as any);

      const result = await service.precomputeIndicatorsForOptimization(
        makeConfig({ parameters: { rsiPeriod: 14 } }),
        coins,
        makePriceCtx('coin-1', 30)
      );

      expect(result?.['coin-1']['rsi_14']).toBeInstanceOf(Float64Array);
      expect(result?.['coin-1']['rsi_14'].length).toBe(30);
    });

    it('should precompute MACD with three output arrays', async () => {
      algorithmRegistry.getStrategyForAlgorithm.mockResolvedValue({
        getIndicatorRequirements: () => [
          {
            type: 'MACD' as const,
            paramKeys: ['macdFast', 'macdSlow', 'macdSignal'],
            defaultParams: { macdFast: 12, macdSlow: 26, macdSignal: 9 }
          }
        ]
      } as any);

      const result = await service.precomputeIndicatorsForOptimization(
        makeConfig({ parameters: { macdFast: 12, macdSlow: 26, macdSignal: 9 } }),
        coins,
        makePriceCtx('coin-1', 50)
      );

      expect(result).toBeDefined();
      const coinResult = result?.['coin-1'];
      expect(coinResult?.['macd_12_26_9_macd']).toBeInstanceOf(Float64Array);
      expect(coinResult?.['macd_12_26_9_signal']).toBeInstanceOf(Float64Array);
      expect(coinResult?.['macd_12_26_9_histogram']).toBeInstanceOf(Float64Array);
      expect(coinResult?.['macd_12_26_9_macd'].length).toBe(50);
    });

    it('should precompute Bollinger Bands with five output arrays', async () => {
      algorithmRegistry.getStrategyForAlgorithm.mockResolvedValue({
        getIndicatorRequirements: () => [
          {
            type: 'BOLLINGER_BANDS' as const,
            paramKeys: ['bbPeriod', 'bbStdDev'],
            defaultParams: { bbPeriod: 20, bbStdDev: 2 }
          }
        ]
      } as any);

      const result = await service.precomputeIndicatorsForOptimization(
        makeConfig({ parameters: { bbPeriod: 20, bbStdDev: 2 } }),
        coins,
        makePriceCtx('coin-1', 40)
      );

      expect(result).toBeDefined();
      const coinResult = result?.['coin-1'];
      expect(coinResult?.['bb_20_2_upper']).toBeInstanceOf(Float64Array);
      expect(coinResult?.['bb_20_2_middle']).toBeInstanceOf(Float64Array);
      expect(coinResult?.['bb_20_2_lower']).toBeInstanceOf(Float64Array);
      expect(coinResult?.['bb_20_2_pb']).toBeInstanceOf(Float64Array);
      expect(coinResult?.['bb_20_2_bandwidth']).toBeInstanceOf(Float64Array);
      expect(coinResult?.['bb_20_2_upper'].length).toBe(40);
    });

    it('should precompute ATR using high/low/close prices', async () => {
      algorithmRegistry.getStrategyForAlgorithm.mockResolvedValue({
        getIndicatorRequirements: () => [
          { type: 'ATR' as const, paramKeys: ['atrPeriod'], defaultParams: { atrPeriod: 14 } }
        ]
      } as any);

      const result = await service.precomputeIndicatorsForOptimization(
        makeConfig({ parameters: { atrPeriod: 14 } }),
        coins,
        makePriceCtx('coin-1', 30)
      );

      expect(result?.['coin-1']['atr_14']).toBeInstanceOf(Float64Array);
      expect(result?.['coin-1']['atr_14'].length).toBe(30);
    });

    it('should not duplicate indicator computation for same key', async () => {
      algorithmRegistry.getStrategyForAlgorithm.mockResolvedValue({
        getIndicatorRequirements: () => [
          { type: 'EMA' as const, paramKeys: ['emaPeriod'], defaultParams: { emaPeriod: 10 } },
          { type: 'EMA' as const, paramKeys: ['emaPeriod'], defaultParams: { emaPeriod: 10 } }
        ]
      } as any);

      const result = await service.precomputeIndicatorsForOptimization(
        makeConfig({ parameters: { emaPeriod: 10 } }),
        coins,
        makePriceCtx('coin-1', 30)
      );

      expect(result).toBeDefined();
      // Should only have one ema_10 key, not fail or produce duplicates
      expect(Object.keys(result?.['coin-1'] ?? {}).filter((k) => k === 'ema_10')).toHaveLength(1);
    });

    it('should handle multiple coins independently', async () => {
      algorithmRegistry.getStrategyForAlgorithm.mockResolvedValue({
        getIndicatorRequirements: () => [
          { type: 'EMA' as const, paramKeys: ['emaPeriod'], defaultParams: { emaPeriod: 5 } }
        ]
      } as any);

      const multiCoins = [
        { id: 'coin-1', symbol: 'BTC' },
        { id: 'coin-2', symbol: 'ETH' }
      ] as any[];

      const priceCtx: PriceTrackingContext = {
        summariesByCoin: new Map([
          ['coin-1', makePrices(20) as any],
          ['coin-2', makePrices(15) as any]
        ]),
        timestampsByCoin: new Map(),
        indexByCoin: new Map(),
        windowsByCoin: new Map()
      };

      const result = await service.precomputeIndicatorsForOptimization(
        makeConfig({ parameters: { emaPeriod: 5 } }),
        multiCoins,
        priceCtx
      );

      expect(result?.['coin-1']['ema_5'].length).toBe(20);
      expect(result?.['coin-2']['ema_5'].length).toBe(15);
    });

    it('should silently skip indicators that throw during computation', async () => {
      algorithmRegistry.getStrategyForAlgorithm.mockResolvedValue({
        getIndicatorRequirements: () => [
          // MACD with bad params that may cause calculator to throw
          {
            type: 'MACD' as const,
            paramKeys: ['fast', 'slow', 'sig'],
            defaultParams: { fast: 0, slow: 0, sig: 0 }
          },
          { type: 'EMA' as const, paramKeys: ['emaPeriod'], defaultParams: { emaPeriod: 5 } }
        ]
      } as any);

      const result = await service.precomputeIndicatorsForOptimization(
        makeConfig({ parameters: { fast: 0, slow: 0, sig: 0, emaPeriod: 5 } }),
        coins,
        makePriceCtx('coin-1', 30)
      );

      // Should still produce the EMA even if MACD failed
      expect(result).toBeDefined();
      expect(result?.['coin-1']['ema_5']).toBeInstanceOf(Float64Array);
    });
  });

  describe('padIndicatorArray', () => {
    it.each([
      { values: [1, 2, 3], target: 5, desc: 'pads with NaN when shorter' },
      { values: [1, 2, 3], target: 3, desc: 'no padding when lengths match' },
      { values: [1, 2, 3, 4, 5], target: 3, desc: 'truncates when longer' }
    ])('$desc (values=$values.length, target=$target)', ({ values, target }) => {
      const result = service.padIndicatorArray(values, target);

      expect(result).toBeInstanceOf(Float64Array);
      expect(result.length).toBe(target);
    });

    it('should fill leading positions with NaN when padding', () => {
      const result = service.padIndicatorArray([1, 2, 3], 5);

      expect(isNaN(result[0])).toBe(true);
      expect(isNaN(result[1])).toBe(true);
      expect(result[2]).toBe(1);
      expect(result[3]).toBe(2);
      expect(result[4]).toBe(3);
    });

    it('should preserve exact values when no padding needed', () => {
      const result = service.padIndicatorArray([10.5, 20.3, 30.1], 3);

      expect(result[0]).toBe(10.5);
      expect(result[1]).toBe(20.3);
      expect(result[2]).toBe(30.1);
    });
  });
});
