import { CompositeRegimeType } from '@chansey/api-interfaces';

import { type FilterableSignal, type SignalFilterContext } from './signal-filter-chain.interface';
import { SignalFilterChainService } from './signal-filter-chain.service';

const makeSignal = (action: string, originalType?: string, coinId?: string): FilterableSignal => ({
  action,
  originalType,
  coinId
});

const makeContext = (overrides: Partial<SignalFilterContext> = {}): SignalFilterContext => ({
  compositeRegime: CompositeRegimeType.BULL,
  riskLevel: 3,
  regimeGateEnabled: true,
  regimeScaledSizingEnabled: false,
  ...overrides
});

const DEFAULT_ALLOCATION = { maxAllocation: 0.1, minAllocation: 0.02 };

describe('SignalFilterChainService', () => {
  let service: SignalFilterChainService;

  beforeEach(() => {
    service = new SignalFilterChainService();
  });

  describe('Gate: regime-based signal blocking', () => {
    it.each([CompositeRegimeType.BULL, CompositeRegimeType.NEUTRAL])('allows BUY signals in %s regime', (regime) => {
      const result = service.apply([makeSignal('BUY')], makeContext({ compositeRegime: regime }), DEFAULT_ALLOCATION);

      expect(result.signals).toHaveLength(1);
      expect(result.regimeGateBlockedCount).toBe(0);
    });

    it.each([CompositeRegimeType.BEAR, CompositeRegimeType.EXTREME])('blocks BUY signals in %s regime', (regime) => {
      const signals = [makeSignal('BUY'), makeSignal('SELL')];
      const result = service.apply(signals, makeContext({ compositeRegime: regime }), DEFAULT_ALLOCATION);

      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].action).toBe('SELL');
      expect(result.regimeGateBlockedCount).toBe(1);
    });

    it('blocks multiple BUY signals and counts correctly', () => {
      const signals = [makeSignal('BUY'), makeSignal('BUY'), makeSignal('SELL')];
      const result = service.apply(
        signals,
        makeContext({ compositeRegime: CompositeRegimeType.BEAR }),
        DEFAULT_ALLOCATION
      );

      expect(result.signals).toHaveLength(1);
      expect(result.regimeGateBlockedCount).toBe(2);
    });

    it('handles case-insensitive BUY action', () => {
      const result = service.apply(
        [makeSignal('buy')],
        makeContext({ compositeRegime: CompositeRegimeType.BEAR }),
        DEFAULT_ALLOCATION
      );

      expect(result.signals).toHaveLength(0);
      expect(result.regimeGateBlockedCount).toBe(1);
    });

    it.each([
      ['STOP_LOSS', CompositeRegimeType.BEAR],
      ['TAKE_PROFIT', CompositeRegimeType.EXTREME]
    ])('allows %s bypass in %s regime', (originalType, regime) => {
      const result = service.apply(
        [makeSignal('SELL', originalType)],
        makeContext({ compositeRegime: regime }),
        DEFAULT_ALLOCATION
      );

      expect(result.signals).toHaveLength(1);
      expect(result.regimeGateBlockedCount).toBe(0);
    });
  });

  describe('Sizing: regime-scaled allocation', () => {
    it.each([
      { regime: CompositeRegimeType.BEAR, riskLevel: 3, expectedMultiplier: 0.1 },
      { regime: CompositeRegimeType.BULL, riskLevel: 3, expectedMultiplier: 1.0 },
      { regime: CompositeRegimeType.EXTREME, riskLevel: 1, expectedMultiplier: 0.02 },
      { regime: CompositeRegimeType.BEAR, riskLevel: 5, expectedMultiplier: 0.2 },
      { regime: CompositeRegimeType.NEUTRAL, riskLevel: 3, expectedMultiplier: 0.5 }
    ])(
      'applies $regime multiplier at risk $riskLevel = $expectedMultiplier',
      ({ regime, riskLevel, expectedMultiplier }) => {
        const result = service.apply(
          [makeSignal('SELL')],
          makeContext({ compositeRegime: regime, regimeScaledSizingEnabled: true, riskLevel }),
          DEFAULT_ALLOCATION
        );

        expect(result.regimeMultiplier).toBeCloseTo(expectedMultiplier);
        expect(result.maxAllocation).toBeCloseTo(0.1 * expectedMultiplier);
        expect(result.minAllocation).toBeCloseTo(0.02 * expectedMultiplier);
      }
    );

    it('falls back to default multipliers for unknown risk level', () => {
      const result = service.apply(
        [makeSignal('SELL')],
        makeContext({ compositeRegime: CompositeRegimeType.BEAR, regimeScaledSizingEnabled: true, riskLevel: 99 }),
        DEFAULT_ALLOCATION
      );

      expect(result.regimeMultiplier).toBeCloseTo(0.1); // DEFAULT_REGIME_MULTIPLIERS[BEAR]
    });
  });

  describe('Combined: gate + sizing', () => {
    it('blocks BUY and scales allocation in BEAR regime', () => {
      const signals = [makeSignal('BUY'), makeSignal('SELL')];
      const ctx = makeContext({
        compositeRegime: CompositeRegimeType.BEAR,
        regimeGateEnabled: true,
        regimeScaledSizingEnabled: true,
        riskLevel: 3
      });

      const result = service.apply(signals, ctx, DEFAULT_ALLOCATION);

      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].action).toBe('SELL');
      expect(result.regimeGateBlockedCount).toBe(1);
      expect(result.regimeMultiplier).toBeCloseTo(0.1);
      expect(result.maxAllocation).toBeCloseTo(0.01);
    });
  });

  describe('Disabled: passthrough', () => {
    it('passes all signals through when both features disabled', () => {
      const signals = [makeSignal('BUY'), makeSignal('SELL')];
      const ctx = makeContext({
        compositeRegime: CompositeRegimeType.EXTREME,
        regimeGateEnabled: false,
        regimeScaledSizingEnabled: false
      });

      const result = service.apply(signals, ctx, DEFAULT_ALLOCATION);

      expect(result.signals).toHaveLength(2);
      expect(result.regimeGateBlockedCount).toBe(0);
      expect(result.regimeMultiplier).toBe(1);
      expect(result.maxAllocation).toBe(DEFAULT_ALLOCATION.maxAllocation);
      expect(result.minAllocation).toBe(DEFAULT_ALLOCATION.minAllocation);
    });
  });

  describe('Context-aware gate policy', () => {
    it.each([CompositeRegimeType.BEAR, CompositeRegimeType.EXTREME])(
      'paper trading allows BUY in %s regime',
      (regime) => {
        const result = service.apply(
          [makeSignal('BUY')],
          makeContext({ compositeRegime: regime, tradingContext: 'paper', riskLevel: 1 }),
          DEFAULT_ALLOCATION
        );

        expect(result.signals).toHaveLength(1);
        expect(result.regimeGateBlockedCount).toBe(0);
      }
    );

    it.each([
      { riskLevel: 1, regime: CompositeRegimeType.BEAR },
      { riskLevel: 1, regime: CompositeRegimeType.EXTREME },
      { riskLevel: 2, regime: CompositeRegimeType.BEAR },
      { riskLevel: 2, regime: CompositeRegimeType.EXTREME }
    ])('live risk $riskLevel blocks BUY in $regime regime', ({ riskLevel, regime }) => {
      const result = service.apply(
        [makeSignal('BUY')],
        makeContext({ compositeRegime: regime, tradingContext: 'live', riskLevel }),
        DEFAULT_ALLOCATION
      );

      expect(result.signals).toHaveLength(0);
      expect(result.regimeGateBlockedCount).toBe(1);
    });

    it.each([
      { riskLevel: 3, regime: CompositeRegimeType.BEAR, expectedLength: 1, expectedBlocked: 0 },
      { riskLevel: 3, regime: CompositeRegimeType.EXTREME, expectedLength: 0, expectedBlocked: 1 },
      { riskLevel: 5, regime: CompositeRegimeType.BEAR, expectedLength: 1, expectedBlocked: 0 },
      { riskLevel: 5, regime: CompositeRegimeType.EXTREME, expectedLength: 0, expectedBlocked: 1 }
    ])(
      'live risk $riskLevel in $regime regime → $expectedLength signals',
      ({ riskLevel, regime, expectedLength, expectedBlocked }) => {
        const result = service.apply(
          [makeSignal('BUY')],
          makeContext({ compositeRegime: regime, tradingContext: 'live', riskLevel }),
          DEFAULT_ALLOCATION
        );

        expect(result.signals).toHaveLength(expectedLength);
        expect(result.regimeGateBlockedCount).toBe(expectedBlocked);
      }
    );

    it('backtest falls through to regimeGateEnabled boolean', () => {
      const blocked = service.apply(
        [makeSignal('BUY')],
        makeContext({ compositeRegime: CompositeRegimeType.BEAR, tradingContext: 'backtest', regimeGateEnabled: true }),
        DEFAULT_ALLOCATION
      );
      expect(blocked.signals).toHaveLength(0);

      const allowed = service.apply(
        [makeSignal('BUY')],
        makeContext({
          compositeRegime: CompositeRegimeType.BEAR,
          tradingContext: 'backtest',
          regimeGateEnabled: false
        }),
        DEFAULT_ALLOCATION
      );
      expect(allowed.signals).toHaveLength(1);
    });

    it('no tradingContext falls through to regimeGateEnabled boolean (backward compat)', () => {
      const blocked = service.apply(
        [makeSignal('BUY')],
        makeContext({ compositeRegime: CompositeRegimeType.BEAR, regimeGateEnabled: true }),
        DEFAULT_ALLOCATION
      );
      expect(blocked.signals).toHaveLength(0);

      const allowed = service.apply(
        [makeSignal('BUY')],
        makeContext({ compositeRegime: CompositeRegimeType.BEAR, regimeGateEnabled: false }),
        DEFAULT_ALLOCATION
      );
      expect(allowed.signals).toHaveLength(1);
    });

    it('paper trading BUY passes gate but allocation is multiplier-reduced in BEAR', () => {
      const result = service.apply(
        [makeSignal('BUY')],
        makeContext({
          compositeRegime: CompositeRegimeType.BEAR,
          tradingContext: 'paper',
          riskLevel: 1,
          regimeScaledSizingEnabled: true
        }),
        DEFAULT_ALLOCATION
      );

      expect(result.signals).toHaveLength(1);
      expect(result.regimeGateBlockedCount).toBe(0);
      expect(result.regimeMultiplier).toBeCloseTo(0.05);
      expect(result.maxAllocation).toBeCloseTo(0.1 * 0.05);
    });
  });

  describe('Concentration filter', () => {
    const makeConcentrationContext = (
      positions: Record<string, { quantity: number; averagePrice: number }>,
      totalValue: number,
      currentPrices?: Record<string, number>
    ) => ({
      portfolioPositions: new Map(Object.entries(positions)),
      portfolioTotalValue: totalValue,
      currentPrices: currentPrices ? new Map(Object.entries(currentPrices)) : undefined
    });

    it('passes through when no concentrationContext is provided', () => {
      const result = service.apply(
        [makeSignal('BUY', undefined, 'btc')],
        makeContext({ compositeRegime: CompositeRegimeType.BULL, regimeGateEnabled: false }),
        DEFAULT_ALLOCATION
      );

      expect(result.signals).toHaveLength(1);
      expect(result.maxAllocation).toBe(DEFAULT_ALLOCATION.maxAllocation);
    });

    it('blocks BUY when asset concentration exceeds hard limit', () => {
      // Risk 3: hard=0.35. BTC at 36% concentration → blocked
      const result = service.apply(
        [makeSignal('BUY', undefined, 'btc'), makeSignal('SELL', undefined, 'eth')],
        makeContext({
          compositeRegime: CompositeRegimeType.BULL,
          regimeGateEnabled: false,
          riskLevel: 3,
          concentrationContext: makeConcentrationContext({ btc: { quantity: 3.6, averagePrice: 100 } }, 1000)
        }),
        DEFAULT_ALLOCATION
      );

      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].action).toBe('SELL');
    });

    it('reduces maxAllocation when position exceeds soft limit', () => {
      // Risk 3: soft=0.30, hard=0.35. BTC at 32% → above soft, cap = hard - concentration = 0.03
      const result = service.apply(
        [makeSignal('BUY', undefined, 'eth')],
        makeContext({
          compositeRegime: CompositeRegimeType.BULL,
          regimeGateEnabled: false,
          riskLevel: 3,
          concentrationContext: makeConcentrationContext({ btc: { quantity: 3.2, averagePrice: 100 } }, 1000)
        }),
        DEFAULT_ALLOCATION
      );

      expect(result.signals).toHaveLength(1);
      expect(result.maxAllocation).toBeCloseTo(0.03);
    });

    it('allows BUY when asset has no existing position', () => {
      const result = service.apply(
        [makeSignal('BUY', undefined, 'eth')],
        makeContext({
          compositeRegime: CompositeRegimeType.BULL,
          regimeGateEnabled: false,
          riskLevel: 3,
          concentrationContext: makeConcentrationContext({ btc: { quantity: 1, averagePrice: 100 } }, 1000)
        }),
        DEFAULT_ALLOCATION
      );

      expect(result.signals).toHaveLength(1);
    });

    it('allows BUY for signals without coinId', () => {
      const result = service.apply(
        [makeSignal('BUY')],
        makeContext({
          compositeRegime: CompositeRegimeType.BULL,
          regimeGateEnabled: false,
          riskLevel: 3,
          concentrationContext: makeConcentrationContext({ btc: { quantity: 5, averagePrice: 100 } }, 1000)
        }),
        DEFAULT_ALLOCATION
      );

      expect(result.signals).toHaveLength(1);
    });

    it('uses currentPrices when available instead of averagePrice', () => {
      // Risk 3: hard=0.35. BTC qty=1, avgPrice=100, but currentPrice=400 → 40% concentration → blocked
      const result = service.apply(
        [makeSignal('BUY', undefined, 'btc')],
        makeContext({
          compositeRegime: CompositeRegimeType.BULL,
          regimeGateEnabled: false,
          riskLevel: 3,
          concentrationContext: makeConcentrationContext({ btc: { quantity: 1, averagePrice: 100 } }, 1000, {
            btc: 400
          })
        }),
        DEFAULT_ALLOCATION
      );

      expect(result.signals).toHaveLength(0);
    });

    it('passes through when portfolioTotalValue is zero', () => {
      const result = service.apply(
        [makeSignal('BUY', undefined, 'btc')],
        makeContext({
          compositeRegime: CompositeRegimeType.BULL,
          regimeGateEnabled: false,
          riskLevel: 3,
          concentrationContext: makeConcentrationContext({ btc: { quantity: 1, averagePrice: 100 } }, 0)
        }),
        DEFAULT_ALLOCATION
      );

      expect(result.signals).toHaveLength(1);
      expect(result.maxAllocation).toBe(DEFAULT_ALLOCATION.maxAllocation);
    });
  });

  describe('Chain integration: regime + concentration', () => {
    it('regime gate blocks BUY before concentration filter runs', () => {
      const result = service.apply(
        [makeSignal('BUY', undefined, 'btc'), makeSignal('SELL', undefined, 'eth')],
        makeContext({
          compositeRegime: CompositeRegimeType.BEAR,
          regimeGateEnabled: true,
          riskLevel: 3,
          concentrationContext: {
            portfolioPositions: new Map([['btc', { quantity: 1, averagePrice: 100 }]]),
            portfolioTotalValue: 1000
          }
        }),
        DEFAULT_ALLOCATION
      );

      // BUY blocked by regime gate, SELL passes through
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].action).toBe('SELL');
      expect(result.regimeGateBlockedCount).toBe(1);
    });
  });

  describe('Override bypass', () => {
    it.each([CompositeRegimeType.BEAR, CompositeRegimeType.EXTREME])(
      'overrideActive bypasses gate in %s regime',
      (regime) => {
        const result = service.apply(
          [makeSignal('BUY')],
          makeContext({ compositeRegime: regime, overrideActive: true }),
          DEFAULT_ALLOCATION
        );

        expect(result.signals).toHaveLength(1);
        expect(result.regimeGateBlockedCount).toBe(0);
      }
    );

    it('overrideActive bypasses gate with live tradingContext', () => {
      const result = service.apply(
        [makeSignal('BUY')],
        makeContext({
          compositeRegime: CompositeRegimeType.EXTREME,
          tradingContext: 'live',
          riskLevel: 1,
          overrideActive: true
        }),
        DEFAULT_ALLOCATION
      );

      expect(result.signals).toHaveLength(1);
      expect(result.regimeGateBlockedCount).toBe(0);
    });

    it.each([CompositeRegimeType.BULL, CompositeRegimeType.NEUTRAL])(
      'live tradingContext allows BUY in %s regime (regression guard)',
      (regime) => {
        const result = service.apply(
          [makeSignal('BUY')],
          makeContext({ compositeRegime: regime, tradingContext: 'live', riskLevel: 1 }),
          DEFAULT_ALLOCATION
        );

        expect(result.signals).toHaveLength(1);
        expect(result.regimeGateBlockedCount).toBe(0);
      }
    );
  });

  describe('Edge cases', () => {
    it('handles empty signals array', () => {
      const result = service.apply([], makeContext({ compositeRegime: CompositeRegimeType.BEAR }), DEFAULT_ALLOCATION);

      expect(result.signals).toHaveLength(0);
      expect(result.regimeGateBlockedCount).toBe(0);
    });
  });
});
