import {
  buildPriceDataContext,
  classifySignalType,
  extractCoinsFromPrices,
  extractSymbolsFromConfig,
  mapStrategySignal,
  resolveMinHoldMs,
  resolveOpportunitySellingConfig,
  toExitType,
  type TradingSignal
} from './paper-trading-engine.utils';

import { SignalType as AlgoSignalType, type TradingSignal as StrategySignal } from '../../../algorithm/interfaces';
import { PaperTradingExitType, PaperTradingSignalType } from '../entities';

describe('paper-trading-engine.utils', () => {
  describe('toExitType', () => {
    it('returns undefined for null/empty', () => {
      expect(toExitType(null)).toBeUndefined();
      expect(toExitType(undefined)).toBeUndefined();
      expect(toExitType('')).toBeUndefined();
    });

    it('returns undefined for invalid values', () => {
      expect(toExitType('not-a-real-exit')).toBeUndefined();
    });

    it('returns the exit type for valid values', () => {
      const valid = Object.values(PaperTradingExitType)[0];
      expect(toExitType(valid as string)).toBe(valid);
    });
  });

  describe('mapStrategySignal', () => {
    const base: StrategySignal = {
      type: AlgoSignalType.BUY,
      coinId: 'BTC',
      reason: 'test',
      confidence: 0.8,
      strength: 0.5,
      quantity: 1,
      metadata: { foo: 'bar' }
    } as unknown as StrategySignal;

    it('maps BUY to BUY action and builds symbol', () => {
      const result = mapStrategySignal(base, 'USD');
      expect(result.action).toBe('BUY');
      expect(result.symbol).toBe('BTC/USD');
      expect(result.coinId).toBe('BTC');
      expect(result.originalType).toBe(AlgoSignalType.BUY);
    });

    it('maps SELL, STOP_LOSS, TAKE_PROFIT to SELL', () => {
      for (const t of [AlgoSignalType.SELL, AlgoSignalType.STOP_LOSS, AlgoSignalType.TAKE_PROFIT]) {
        const r = mapStrategySignal({ ...base, type: t } as StrategySignal, 'USD');
        expect(r.action).toBe('SELL');
        expect(r.originalType).toBe(t);
      }
    });

    it('maps SHORT_ENTRY and SHORT_EXIT', () => {
      expect(mapStrategySignal({ ...base, type: AlgoSignalType.SHORT_ENTRY } as StrategySignal, 'USD').action).toBe(
        'OPEN_SHORT'
      );
      expect(mapStrategySignal({ ...base, type: AlgoSignalType.SHORT_EXIT } as StrategySignal, 'USD').action).toBe(
        'CLOSE_SHORT'
      );
    });
  });

  describe('classifySignalType', () => {
    const mk = (overrides: Partial<TradingSignal>): TradingSignal =>
      ({ action: 'BUY', coinId: 'BTC', symbol: 'BTC/USD', reason: 'x', ...overrides }) as TradingSignal;

    it('classifies STOP_LOSS/TAKE_PROFIT as RISK_CONTROL', () => {
      expect(classifySignalType(mk({ originalType: AlgoSignalType.STOP_LOSS }))).toBe(
        PaperTradingSignalType.RISK_CONTROL
      );
      expect(classifySignalType(mk({ originalType: AlgoSignalType.TAKE_PROFIT }))).toBe(
        PaperTradingSignalType.RISK_CONTROL
      );
    });

    it('classifies BUY and OPEN_SHORT as ENTRY', () => {
      expect(classifySignalType(mk({ action: 'BUY' }))).toBe(PaperTradingSignalType.ENTRY);
      expect(classifySignalType(mk({ action: 'OPEN_SHORT' }))).toBe(PaperTradingSignalType.ENTRY);
    });

    it('classifies SELL and CLOSE_SHORT as EXIT', () => {
      expect(classifySignalType(mk({ action: 'SELL' }))).toBe(PaperTradingSignalType.EXIT);
      expect(classifySignalType(mk({ action: 'CLOSE_SHORT' }))).toBe(PaperTradingSignalType.EXIT);
    });

    it('classifies HOLD as ADJUSTMENT', () => {
      expect(classifySignalType(mk({ action: 'HOLD' }))).toBe(PaperTradingSignalType.ADJUSTMENT);
    });
  });

  describe('resolveMinHoldMs', () => {
    const DEFAULT = 24 * 60 * 60 * 1000;
    it('returns default when config missing', () => {
      expect(resolveMinHoldMs()).toBe(DEFAULT);
      expect(resolveMinHoldMs({})).toBe(DEFAULT);
    });
    it('returns default for invalid values', () => {
      expect(resolveMinHoldMs({ minHoldMs: -1 })).toBe(DEFAULT);
      expect(resolveMinHoldMs({ minHoldMs: 'x' })).toBe(DEFAULT);
      expect(resolveMinHoldMs({ minHoldMs: Infinity })).toBe(DEFAULT);
    });
    it('returns the configured value', () => {
      expect(resolveMinHoldMs({ minHoldMs: 5000 })).toBe(5000);
      expect(resolveMinHoldMs({ minHoldMs: 0 })).toBe(0);
    });
  });

  describe('extractSymbolsFromConfig', () => {
    it('returns empty for undefined config', () => {
      expect(extractSymbolsFromConfig()).toEqual([]);
    });

    it('extracts from symbols and tradingPairs', () => {
      expect(extractSymbolsFromConfig({ symbols: ['BTC/USD'], tradingPairs: ['ETH/USD'] })).toEqual([
        'BTC/USD',
        'ETH/USD'
      ]);
    });

    it('deduplicates across and within arrays', () => {
      const result = extractSymbolsFromConfig({
        symbols: ['BTC/USD', 'ETH/USD', 'BTC/USD'],
        tradingPairs: ['ETH/USD', 'SOL/USD']
      });
      expect(result).toEqual(['BTC/USD', 'ETH/USD', 'SOL/USD']);
    });

    it('ignores non-string entries', () => {
      expect(extractSymbolsFromConfig({ symbols: ['BTC/USD', 123, null] as unknown[] })).toEqual(['BTC/USD']);
    });
  });

  describe('extractCoinsFromPrices', () => {
    it('extracts unique base currencies', () => {
      const result = extractCoinsFromPrices({ 'BTC/USD': 1, 'ETH/USD': 2, 'BTC/USDT': 3 });
      expect(result).toEqual([
        { id: 'BTC', symbol: 'BTC' },
        { id: 'ETH', symbol: 'ETH' }
      ]);
    });

    it('returns empty for empty prices', () => {
      expect(extractCoinsFromPrices({})).toEqual([]);
    });
  });

  describe('buildPriceDataContext', () => {
    it('creates single-candle entry when no history', () => {
      const ctx = buildPriceDataContext({ 'BTC/USD': 100 });
      expect(ctx.BTC).toHaveLength(1);
      expect(ctx.BTC[0].avg).toBe(100);
    });

    it('appends current price to historical candles', () => {
      const past = new Date('2024-01-01');
      const ctx = buildPriceDataContext(
        { 'BTC/USD': 150 },
        { 'BTC/USD': [{ avg: 100, high: 110, low: 90, date: past }] }
      );
      expect(ctx.BTC).toHaveLength(2);
      expect(ctx.BTC[1].avg).toBe(150);
    });

    it('prefers the longer candidate when multiple symbols share a base', () => {
      const past = new Date('2024-01-01');
      const ctx = buildPriceDataContext(
        { 'BTC/USD': 150, 'BTC/USDT': 151 },
        { 'BTC/USD': [{ avg: 100, high: 110, low: 90, date: past }] }
      );
      expect(ctx.BTC.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('resolveOpportunitySellingConfig', () => {
    it('returns disabled default when config missing', () => {
      const result = resolveOpportunitySellingConfig();
      expect(result.enabled).toBe(false);
      expect(result.config).toBeDefined();
    });

    it('returns disabled when enableOpportunitySelling is false', () => {
      const result = resolveOpportunitySellingConfig({ enableOpportunitySelling: false });
      expect(result.enabled).toBe(false);
    });

    it('returns enabled with default config when enabled but no user config', () => {
      const result = resolveOpportunitySellingConfig({ enableOpportunitySelling: true });
      expect(result.enabled).toBe(true);
    });

    it('clamps user values into valid ranges', () => {
      const result = resolveOpportunitySellingConfig({
        enableOpportunitySelling: true,
        opportunitySellingConfig: {
          minOpportunityConfidence: 99,
          minHoldingPeriodHours: -5,
          maxLiquidationPercent: 500,
          protectedCoins: ['BTC']
        }
      });
      expect(result.enabled).toBe(true);
      expect(result.config.minOpportunityConfidence).toBeLessThanOrEqual(1);
      expect(result.config.minHoldingPeriodHours).toBeGreaterThanOrEqual(0);
      expect(result.config.maxLiquidationPercent).toBeLessThanOrEqual(100);
      expect(result.config.protectedCoins).toEqual(['BTC']);
    });
  });
});
