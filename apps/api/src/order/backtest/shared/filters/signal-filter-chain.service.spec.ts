import { CompositeRegimeType } from '@chansey/api-interfaces';

import { FilterableSignal, SignalFilterContext } from './signal-filter-chain.interface';
import { SignalFilterChainService } from './signal-filter-chain.service';

const makeSignal = (action: string, originalType?: string): FilterableSignal => ({ action, originalType });

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

  describe('Edge cases', () => {
    it('handles empty signals array', () => {
      const result = service.apply([], makeContext({ compositeRegime: CompositeRegimeType.BEAR }), DEFAULT_ALLOCATION);

      expect(result.signals).toHaveLength(0);
      expect(result.regimeGateBlockedCount).toBe(0);
    });
  });
});
