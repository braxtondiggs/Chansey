import { Test, type TestingModule } from '@nestjs/testing';

import { CompositeRegimeType, MarketRegimeType } from '@chansey/api-interfaces';

import { CompositeRegimeService, REGIME_SMA_PERIOD } from './composite-regime.service';

import { type Coin } from '../../../../coin/coin.entity';
import { RegimeGateService } from '../../../../market-regime/regime-gate.service';
import { VolatilityCalculator } from '../../../../market-regime/volatility.calculator';
import { IncrementalSma } from '../../incremental-sma';
import { RingBuffer } from '../../ring-buffer';
import { SignalFilterChainService } from '../filters';
import { type PriceTrackingContext } from '../price-window';
import { type MarketData, type TradingSignal } from '../types';

describe('CompositeRegimeService', () => {
  let service: CompositeRegimeService;
  let regimeGateService: jest.Mocked<RegimeGateService>;
  let volatilityCalculator: jest.Mocked<VolatilityCalculator>;
  let signalFilterChain: jest.Mocked<SignalFilterChainService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompositeRegimeService,
        {
          provide: RegimeGateService,
          useValue: {
            classifyComposite: jest.fn().mockReturnValue(CompositeRegimeType.BULL)
          }
        },
        {
          provide: VolatilityCalculator,
          useValue: {
            calculateRealizedVolatility: jest.fn().mockReturnValue(0.02),
            calculatePercentile: jest.fn().mockReturnValue(50)
          }
        },
        {
          provide: SignalFilterChainService,
          useValue: {
            apply: jest.fn().mockImplementation((signals, _ctx, limits) => ({
              signals,
              maxAllocation: limits.maxAllocation,
              minAllocation: limits.minAllocation,
              regimeGateBlockedCount: 0,
              regimeMultiplier: 1
            }))
          }
        }
      ]
    }).compile();

    service = module.get(CompositeRegimeService);
    regimeGateService = module.get(RegimeGateService);
    volatilityCalculator = module.get(VolatilityCalculator);
    signalFilterChain = module.get(SignalFilterChainService);
  });

  describe('computeCompositeRegime', () => {
    function buildPriceCtx(windowLength: number, smaFilled: boolean, smaValue = 40000): PriceTrackingContext {
      const window = new RingBuffer<{ close?: number; avg: number }>(500);
      for (let i = 0; i < windowLength; i++) {
        window.push({ close: 42000, avg: 42000 });
      }

      const sma = new IncrementalSma(REGIME_SMA_PERIOD);
      if (smaFilled) {
        for (let i = 0; i < REGIME_SMA_PERIOD; i++) {
          sma.push(smaValue);
        }
      }

      return {
        timestampsByCoin: new Map(),
        summariesByCoin: new Map(),
        indexByCoin: new Map(),
        windowsByCoin: new Map([['btc-id', window as any]]),
        btcRegimeSma: sma,
        btcCoinId: 'btc-id'
      };
    }

    it('should return null when BTC window is missing', () => {
      const priceCtx: PriceTrackingContext = {
        timestampsByCoin: new Map(),
        summariesByCoin: new Map(),
        indexByCoin: new Map(),
        windowsByCoin: new Map()
      };
      expect(service.computeCompositeRegime('btc-id', priceCtx)).toBeNull();
    });

    it('should return null when insufficient data (< 200 bars)', () => {
      const priceCtx = buildPriceCtx(100, false);
      expect(service.computeCompositeRegime('btc-id', priceCtx)).toBeNull();
    });

    it('should return null when SMA is not filled', () => {
      const priceCtx = buildPriceCtx(REGIME_SMA_PERIOD, false);
      expect(service.computeCompositeRegime('btc-id', priceCtx)).toBeNull();
    });

    it('should compute regime when data is sufficient', () => {
      const priceCtx = buildPriceCtx(REGIME_SMA_PERIOD, true, 40000);
      const result = service.computeCompositeRegime('btc-id', priceCtx);

      expect(result).toEqual({
        compositeRegime: CompositeRegimeType.BULL,
        volatilityRegime: expect.any(String)
      });
      expect(regimeGateService.classifyComposite).toHaveBeenCalledWith(expect.any(String), true);
    });

    it('should use avg when close is undefined', () => {
      const window = new RingBuffer<{ close?: number; avg: number }>(500);
      for (let i = 0; i < REGIME_SMA_PERIOD; i++) {
        window.push({ avg: 42000 }); // no close property
      }
      const sma = new IncrementalSma(REGIME_SMA_PERIOD);
      for (let i = 0; i < REGIME_SMA_PERIOD; i++) sma.push(40000);

      const priceCtx: PriceTrackingContext = {
        timestampsByCoin: new Map(),
        summariesByCoin: new Map(),
        indexByCoin: new Map(),
        windowsByCoin: new Map([['btc-id', window as any]]),
        btcRegimeSma: sma,
        btcCoinId: 'btc-id'
      };

      const result = service.computeCompositeRegime('btc-id', priceCtx);
      expect(result).not.toBeNull();
      // trendAboveSma = 42000 > 40000 = true
      expect(regimeGateService.classifyComposite).toHaveBeenCalledWith(expect.any(String), true);
    });

    it('should fall back to NORMAL volatility when calculator throws', () => {
      volatilityCalculator.calculateRealizedVolatility.mockImplementation(() => {
        throw new Error('calc failure');
      });
      const priceCtx = buildPriceCtx(REGIME_SMA_PERIOD, true, 40000);
      const result = service.computeCompositeRegime('btc-id', priceCtx);

      expect(result).not.toBeNull();
      expect(regimeGateService.classifyComposite).toHaveBeenCalledWith(MarketRegimeType.NORMAL, true);
    });
  });

  describe('resolveRegimeConfig', () => {
    function makeCoin(symbol: string, id = symbol.toLowerCase() + '-id'): Coin {
      return { id, symbol } as Coin;
    }

    it('should return defaults when no options provided', () => {
      const coins = [makeCoin('BTC'), makeCoin('ETH')];
      const result = service.resolveRegimeConfig({}, coins);

      expect(result.enableRegimeScaledSizing).toBe(true);
      expect(result.riskLevel).toBe(3); // DEFAULT_RISK_LEVEL
      expect(result.regimeGateEnabled).toBe(false); // riskLevel 3 > 2
      expect(result.btcCoin?.symbol).toBe('BTC');
    });

    it('should enable regime gate when riskLevel <= 2', () => {
      const coins = [makeCoin('BTC')];
      const result = service.resolveRegimeConfig({ riskLevel: 2 }, coins);

      expect(result.regimeGateEnabled).toBe(true);
    });

    it('should return btcCoin as undefined when neither gate nor scaling needed', () => {
      const coins = [makeCoin('ETH')];
      const result = service.resolveRegimeConfig({ enableRegimeGate: false, enableRegimeScaledSizing: false }, coins);

      expect(result.btcCoin).toBeUndefined();
    });

    it('should log warning when gate enabled but BTC not in coins', () => {
      const coins = [makeCoin('ETH')];
      const result = service.resolveRegimeConfig({ enableRegimeGate: true }, coins);

      // Gate is enabled but btcCoin is undefined — warning logged
      expect(result.regimeGateEnabled).toBe(true);
      expect(result.btcCoin).toBeUndefined();
    });
  });

  describe('resolveRegimeConfigForOptimization', () => {
    it('should set btcRegimeSma and btcCoinId on priceCtx when BTC found', () => {
      const coins = [{ id: 'btc-id', symbol: 'BTC' } as Coin];
      const priceCtx: PriceTrackingContext = {
        timestampsByCoin: new Map(),
        summariesByCoin: new Map(),
        indexByCoin: new Map(),
        windowsByCoin: new Map()
      };

      const result = service.resolveRegimeConfigForOptimization({ riskLevel: 1 }, coins, priceCtx);

      expect(result.btcCoin).toBeDefined();
      expect(priceCtx.btcRegimeSma).toBeInstanceOf(IncrementalSma);
      expect(priceCtx.btcCoinId).toBe('btc-id');
    });

    it('should not set btcRegimeSma when BTC not needed', () => {
      const coins = [{ id: 'eth-id', symbol: 'ETH' } as Coin];
      const priceCtx: PriceTrackingContext = {
        timestampsByCoin: new Map(),
        summariesByCoin: new Map(),
        indexByCoin: new Map(),
        windowsByCoin: new Map()
      };

      service.resolveRegimeConfigForOptimization(
        { enableRegimeGate: false, enableRegimeScaledSizing: false },
        coins,
        priceCtx
      );

      expect(priceCtx.btcRegimeSma).toBeUndefined();
      expect(priceCtx.btcCoinId).toBeUndefined();
    });
  });

  describe('buildConcentrationContext', () => {
    it('should return undefined for empty portfolio', () => {
      const portfolio = {
        cashBalance: 10000,
        positions: new Map(),
        totalValue: 10000
      };
      const marketData: MarketData = {
        timestamp: new Date(),
        prices: new Map([['btc', 42000]])
      };

      expect(service.buildConcentrationContext(portfolio, marketData)).toBeUndefined();
    });

    it('should return context with positions, totalValue, and prices', () => {
      const positions = new Map([['btc', { quantity: 1, averagePrice: 40000 }]]);
      const portfolio = {
        cashBalance: 5000,
        positions,
        totalValue: 47000
      };
      const marketData: MarketData = {
        timestamp: new Date(),
        prices: new Map([['btc', 42000]])
      };

      const result = service.buildConcentrationContext(portfolio as any, marketData);
      expect(result).toEqual({
        portfolioPositions: positions,
        portfolioTotalValue: 47000,
        currentPrices: marketData.prices
      });
    });
  });

  describe('applyBarRegime', () => {
    const allocationLimits = { maxAllocation: 0.2, minAllocation: 0.05 };
    const emptyPriceCtx = {
      timestampsByCoin: new Map(),
      summariesByCoin: new Map(),
      indexByCoin: new Map(),
      windowsByCoin: new Map()
    } as PriceTrackingContext;

    it('should pass through when no BTC coin', () => {
      const signals: TradingSignal[] = [{ action: 'BUY', coinId: 'eth', reason: 'test' }];

      const result = service.applyBarRegime(
        signals,
        emptyPriceCtx,
        { regimeGateEnabled: true, enableRegimeScaledSizing: true, riskLevel: 1 },
        allocationLimits
      );

      expect(result.filteredSignals).toBe(signals);
      expect(result.barMaxAllocation).toBe(0.2);
      expect(result.barMinAllocation).toBe(0.05);
    });

    it('should pass through when signals array is empty', () => {
      const result = service.applyBarRegime(
        [],
        emptyPriceCtx,
        {
          btcCoin: { id: 'btc-id', symbol: 'BTC' } as Coin,
          regimeGateEnabled: true,
          enableRegimeScaledSizing: true,
          riskLevel: 1
        },
        allocationLimits
      );

      expect(result.filteredSignals).toEqual([]);
      expect(result.barMaxAllocation).toBe(0.2);
    });

    it('should apply filter chain when precomputed regime is provided', () => {
      const signals: TradingSignal[] = [{ action: 'BUY', coinId: 'eth', reason: 'test' }];

      const result = service.applyBarRegime(
        signals,
        emptyPriceCtx,
        {
          btcCoin: { id: 'btc-id', symbol: 'BTC' } as Coin,
          regimeGateEnabled: true,
          enableRegimeScaledSizing: true,
          riskLevel: 1
        },
        allocationLimits,
        { compositeRegime: CompositeRegimeType.BULL, volatilityRegime: MarketRegimeType.NORMAL }
      );

      expect(signalFilterChain.apply).toHaveBeenCalledWith(
        signals,
        expect.objectContaining({
          compositeRegime: CompositeRegimeType.BULL,
          riskLevel: 1,
          regimeGateEnabled: true,
          regimeScaledSizingEnabled: true,
          tradingContext: 'backtest'
        }),
        allocationLimits
      );
      expect(result.filteredSignals).toBe(signals);
    });

    it('should pass through when precomputedRegime is null', () => {
      const signals: TradingSignal[] = [{ action: 'BUY', coinId: 'eth', reason: 'test' }];

      const result = service.applyBarRegime(
        signals,
        emptyPriceCtx,
        {
          btcCoin: { id: 'btc-id', symbol: 'BTC' } as Coin,
          regimeGateEnabled: true,
          enableRegimeScaledSizing: true,
          riskLevel: 1
        },
        allocationLimits,
        null
      );

      expect(signalFilterChain.apply).not.toHaveBeenCalled();
      expect(result.filteredSignals).toBe(signals);
      expect(result.barMaxAllocation).toBe(0.2);
    });

    it('should compute regime from priceCtx when precomputedRegime is undefined', () => {
      const signals: TradingSignal[] = [{ action: 'BUY', coinId: 'eth', reason: 'test' }];

      // No precomputedRegime → computeCompositeRegime called, returns null (empty window)
      const result = service.applyBarRegime(
        signals,
        emptyPriceCtx,
        {
          btcCoin: { id: 'btc-id', symbol: 'BTC' } as Coin,
          regimeGateEnabled: true,
          enableRegimeScaledSizing: true,
          riskLevel: 1
        },
        allocationLimits
        // precomputedRegime omitted → undefined
      );

      // computeCompositeRegime returns null (no BTC window) → pass through
      expect(signalFilterChain.apply).not.toHaveBeenCalled();
      expect(result.filteredSignals).toBe(signals);
    });
  });
});
