import { Logger } from '@nestjs/common';

import {
  type AdxGateContext,
  applyAdxGate,
  getAdxGateConfigDefaults,
  getAdxGateRequirement,
  getAdxGateSchema,
  getLatestAdxBundle
} from './adx-gate.util';
import { type IndicatorService } from './indicator.service';

import { type CandleData } from '../../ohlc/ohlc-candle.entity';
import { SignalType, type TradingSignal } from '../interfaces';

const buildSignal = (overrides: Partial<TradingSignal> = {}): TradingSignal => ({
  type: SignalType.BUY,
  coinId: 'btc',
  strength: 0.8,
  confidence: 0.7,
  reason: 'test',
  metadata: { source: 'test' },
  ...overrides
});

const buildContext = (overrides: Partial<AdxGateContext> = {}): AdxGateContext => ({
  indicatorService: {
    calculateADX: jest.fn()
  } as unknown as IndicatorService,
  getPrecomputedSlice: jest.fn(() => undefined),
  logger: new Logger('test'),
  isBacktest: true,
  skipCache: true,
  ...overrides
});

const mockSlices = (slices: Record<string, number[]>): jest.Mock =>
  jest.fn((_coinId: string, key: string) => slices[key]);

describe('adx-gate.util', () => {
  describe('getAdxGateConfigDefaults', () => {
    it('fills missing fields with documented defaults', () => {
      expect(getAdxGateConfigDefaults({})).toEqual({
        adxPeriod: 14,
        minAdx: 0,
        adxStrongMin: 0,
        adxWeakMultiplier: 0.5
      });
    });

    it('preserves explicit values', () => {
      expect(getAdxGateConfigDefaults({ adxPeriod: 21, minAdx: 25, adxStrongMin: 30, adxWeakMultiplier: 0.4 })).toEqual(
        {
          adxPeriod: 21,
          minAdx: 25,
          adxStrongMin: 30,
          adxWeakMultiplier: 0.4
        }
      );
    });
  });

  describe('getAdxGateSchema', () => {
    it('returns the four documented schema entries with correct bounds', () => {
      const schema = getAdxGateSchema();
      expect(Object.keys(schema).sort()).toEqual(['adxPeriod', 'adxStrongMin', 'adxWeakMultiplier', 'minAdx']);
      expect(schema.adxPeriod).toMatchObject({ default: 14, min: 7, max: 28 });
      expect(schema.minAdx).toMatchObject({ default: 0, min: 0, max: 40 });
      expect(schema.adxStrongMin).toMatchObject({ default: 0, min: 0, max: 60 });
      expect(schema.adxWeakMultiplier).toMatchObject({ default: 0.5, min: 0.1, max: 1 });
    });
  });

  describe('getAdxGateRequirement', () => {
    it.each([
      ['undefined minAdx', {}],
      ['minAdx of zero', { minAdx: 0 }],
      ['negative minAdx', { minAdx: -5 }]
    ])('returns null when %s', (_label, config) => {
      expect(getAdxGateRequirement(config)).toBeNull();
    });

    it('returns ADX requirement when minAdx > 0', () => {
      expect(getAdxGateRequirement({ minAdx: 20 })).toEqual({
        type: 'ADX',
        paramKeys: ['adxPeriod'],
        defaultParams: { adxPeriod: 14 }
      });
    });
  });

  describe('getLatestAdxBundle', () => {
    const priceHistory: CandleData[] = [];

    it('returns the precomputed bundle when slices are present', async () => {
      const ctx = buildContext({
        getPrecomputedSlice: mockSlices({ adx_14: [25], adx_14_pdi: [22], adx_14_mdi: [18] })
      });

      const bundle = await getLatestAdxBundle(ctx, 'btc', priceHistory, 14);

      expect(bundle).toEqual({ adx: 25, pdi: 22, mdi: 18 });
      expect(ctx.indicatorService.calculateADX).not.toHaveBeenCalled();
    });

    it('returns NaN for pdi/mdi when only the adx slice is precomputed', async () => {
      const ctx = buildContext({
        getPrecomputedSlice: mockSlices({ adx_14: [25] })
      });

      const bundle = await getLatestAdxBundle(ctx, 'btc', priceHistory, 14);

      expect(bundle?.adx).toBe(25);
      expect(bundle?.pdi).toBeNaN();
      expect(bundle?.mdi).toBeNaN();
      expect(ctx.indicatorService.calculateADX).not.toHaveBeenCalled();
    });

    it('falls back to IndicatorService when slice is missing', async () => {
      const calculateADX = jest.fn().mockResolvedValue({
        values: [27],
        pdi: [21],
        mdi: [19],
        validCount: 1,
        period: 14,
        fromCache: false
      });
      const ctx = buildContext({
        indicatorService: { calculateADX } as unknown as IndicatorService
      });

      const bundle = await getLatestAdxBundle(ctx, 'btc', priceHistory, 14);

      expect(bundle).toEqual({ adx: 27, pdi: 21, mdi: 19 });
      expect(calculateADX).toHaveBeenCalled();
    });

    it('returns null when calculateADX throws and logs at debug level', async () => {
      const error = new Error('boom');
      const calculateADX = jest.fn().mockRejectedValue(error);
      const debug = jest.fn();
      const ctx = buildContext({
        indicatorService: { calculateADX } as unknown as IndicatorService,
        logger: { debug } as unknown as Logger
      });

      const bundle = await getLatestAdxBundle(ctx, 'btc', priceHistory, 14);

      expect(bundle).toBeNull();
      expect(debug).toHaveBeenCalledWith('ADX calc failed for btc', error);
    });

    it('returns null when computed adx is non-finite', async () => {
      const calculateADX = jest.fn().mockResolvedValue({
        values: [NaN],
        pdi: [],
        mdi: [],
        validCount: 0,
        period: 14,
        fromCache: false
      });
      const ctx = buildContext({
        indicatorService: { calculateADX } as unknown as IndicatorService
      });

      expect(await getLatestAdxBundle(ctx, 'btc', priceHistory, 14)).toBeNull();
    });
  });

  describe('applyAdxGate', () => {
    const coin = { id: 'btc', symbol: 'BTC' };
    const priceHistory: CandleData[] = [];
    const baseConfig = { adxPeriod: 14, minAdx: 20, adxStrongMin: 25, adxWeakMultiplier: 0.5 } as const;

    it('passes the signal through unchanged when minAdx <= 0', async () => {
      const ctx = buildContext();
      const signal = buildSignal();
      const out = await applyAdxGate(ctx, coin, priceHistory, signal, { ...baseConfig, minAdx: 0, adxStrongMin: 0 });
      expect(out).not.toBe(signal);
      expect(out).toEqual(signal);
    });

    it('blocks (returns null) when adx is below minAdx', async () => {
      const ctx = buildContext({
        getPrecomputedSlice: mockSlices({ adx_14: [10] })
      });
      const out = await applyAdxGate(ctx, coin, priceHistory, buildSignal(), { ...baseConfig, adxStrongMin: 0 });
      expect(out).toBeNull();
    });

    it('blocks (returns null) when bundle is unavailable', async () => {
      const calculateADX = jest.fn().mockRejectedValue(new Error('boom'));
      const ctx = buildContext({
        indicatorService: { calculateADX } as unknown as IndicatorService
      });
      const out = await applyAdxGate(ctx, coin, priceHistory, buildSignal(), { ...baseConfig, adxStrongMin: 0 });
      expect(out).toBeNull();
    });

    it('logs at debug when blocking in live (non-backtest) mode', async () => {
      const debug = jest.fn();
      const ctx = buildContext({
        isBacktest: false,
        logger: { debug } as unknown as Logger,
        getPrecomputedSlice: mockSlices({ adx_14: [10] })
      });
      await applyAdxGate(ctx, coin, priceHistory, buildSignal(), { ...baseConfig, adxStrongMin: 0 });
      expect(debug).toHaveBeenCalledWith(expect.stringContaining('ADX gate blocked BTC'));
    });

    it('reduces strength in the weak tier', async () => {
      const ctx = buildContext({
        getPrecomputedSlice: mockSlices({ adx_14: [22], adx_14_pdi: [18], adx_14_mdi: [12] })
      });
      const out = await applyAdxGate(ctx, coin, priceHistory, buildSignal({ strength: 1 }), baseConfig);
      expect(out).not.toBeNull();
      expect(out?.strength).toBe(0.5);
      expect(out?.metadata).toMatchObject({ adx: 22, pdi: 18, mdi: 12, trendStrength: 'weak' });
    });

    it('keeps strength in the strong tier', async () => {
      const ctx = buildContext({
        getPrecomputedSlice: mockSlices({ adx_14: [30], adx_14_pdi: [25], adx_14_mdi: [10] })
      });
      const out = await applyAdxGate(ctx, coin, priceHistory, buildSignal({ strength: 1 }), baseConfig);
      expect(out).not.toBeNull();
      expect(out?.strength).toBe(1);
      expect(out?.metadata).toMatchObject({ adx: 30, trendStrength: 'strong' });
    });

    it('preserves strength when tiered logic is disabled (adxStrongMin <= minAdx)', async () => {
      const ctx = buildContext({
        getPrecomputedSlice: mockSlices({ adx_14: [21] })
      });
      const out = await applyAdxGate(ctx, coin, priceHistory, buildSignal({ strength: 1 }), {
        ...baseConfig,
        adxStrongMin: 0
      });
      expect(out?.strength).toBe(1);
      expect(out?.metadata).toMatchObject({ adx: 21 });
    });

    it('does not mutate the input signal on the strong-tier path', async () => {
      const ctx = buildContext({
        getPrecomputedSlice: mockSlices({ adx_14: [30] })
      });
      const original = buildSignal({ strength: 1, metadata: { source: 'macd' } });
      const snapshot = JSON.parse(JSON.stringify(original));
      const out = await applyAdxGate(ctx, coin, priceHistory, original, { ...baseConfig, adxStrongMin: 0 });
      expect(out).not.toBe(original);
      expect(original).toEqual(snapshot);
      expect(out?.metadata).not.toBe(original.metadata);
      expect(out?.metadata).toMatchObject({ source: 'macd', adx: 30 });
    });

    it('does not mutate the input signal on the weak-tier path', async () => {
      const ctx = buildContext({
        getPrecomputedSlice: mockSlices({ adx_14: [22] })
      });
      const original = buildSignal({ strength: 1, metadata: { source: 'ema' } });
      const snapshot = JSON.parse(JSON.stringify(original));
      const out = await applyAdxGate(ctx, coin, priceHistory, original, { ...baseConfig, adxWeakMultiplier: 0.4 });
      expect(out).not.toBe(original);
      expect(original).toEqual(snapshot);
      expect(out?.strength).toBe(0.4);
    });
  });
});
