import { CompositeRegimeType, MarketRegimeType } from '@chansey/api-interfaces';

import { RegimeGateService } from './regime-gate.service';

describe('RegimeGateService', () => {
  let service: RegimeGateService;

  beforeEach(() => {
    service = new RegimeGateService();
  });

  // ---------------------------------------------------------------------------
  // filterBacktestSignals()
  // ---------------------------------------------------------------------------
  describe('filterBacktestSignals', () => {
    it('should return all signals in BULL regime', () => {
      const signals = [
        { action: 'BUY', coinId: 'BTC' },
        { action: 'SELL', coinId: 'ETH' },
        { action: 'BUY', coinId: 'SOL' }
      ];

      const result = service.filterBacktestSignals(signals, CompositeRegimeType.BULL);
      expect(result).toHaveLength(3);
    });

    it('should filter out BUY signals in BEAR regime', () => {
      const signals = [
        { action: 'BUY', coinId: 'BTC' },
        { action: 'SELL', coinId: 'ETH' },
        { action: 'BUY', coinId: 'SOL' }
      ];

      const result = service.filterBacktestSignals(signals, CompositeRegimeType.BEAR);
      expect(result).toHaveLength(1);
      expect(result[0].action).toBe('SELL');
    });

    it('should allow STOP_LOSS and TAKE_PROFIT signals even in bearish regimes', () => {
      const signals = [
        { action: 'BUY', coinId: 'BTC', originalType: 'STOP_LOSS' },
        { action: 'BUY', coinId: 'ETH', originalType: 'TAKE_PROFIT' },
        { action: 'BUY', coinId: 'SOL' }
      ];

      const result = service.filterBacktestSignals(signals, CompositeRegimeType.EXTREME);
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.originalType)).toEqual(['STOP_LOSS', 'TAKE_PROFIT']);
    });

    it('should return empty array when given empty array', () => {
      expect(service.filterBacktestSignals([], CompositeRegimeType.BEAR)).toHaveLength(0);
    });

    it('should return empty array when all signals are blocked', () => {
      const signals = [
        { action: 'BUY', coinId: 'BTC' },
        { action: 'BUY', coinId: 'ETH' }
      ];

      expect(service.filterBacktestSignals(signals, CompositeRegimeType.EXTREME)).toHaveLength(0);
    });

    it('should preserve additional signal properties through filtering', () => {
      interface TestSignal {
        action: string;
        coinId: string;
        confidence: number;
        originalType?: string;
      }

      const signals: TestSignal[] = [
        { action: 'SELL', coinId: 'BTC', confidence: 0.85 },
        { action: 'BUY', coinId: 'ETH', confidence: 0.9 },
        { action: 'BUY', coinId: 'SOL', confidence: 0.7, originalType: 'STOP_LOSS' }
      ];

      const result = service.filterBacktestSignals(signals, CompositeRegimeType.BEAR);
      expect(result).toHaveLength(2);
      expect(result[0].confidence).toBe(0.85);
      expect(result[1].confidence).toBe(0.7);
    });

    it('should not modify the original array', () => {
      const signals = [
        { action: 'BUY', coinId: 'BTC' },
        { action: 'SELL', coinId: 'ETH' }
      ];

      service.filterBacktestSignals(signals, CompositeRegimeType.BEAR);
      expect(signals).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // classifyComposite()
  // ---------------------------------------------------------------------------
  describe('classifyComposite', () => {
    it.each([
      [MarketRegimeType.LOW_VOLATILITY, true, CompositeRegimeType.BULL],
      [MarketRegimeType.NORMAL, true, CompositeRegimeType.BULL],
      [MarketRegimeType.HIGH_VOLATILITY, true, CompositeRegimeType.NEUTRAL],
      [MarketRegimeType.EXTREME, true, CompositeRegimeType.NEUTRAL],
      [MarketRegimeType.LOW_VOLATILITY, false, CompositeRegimeType.BEAR],
      [MarketRegimeType.NORMAL, false, CompositeRegimeType.BEAR],
      [MarketRegimeType.HIGH_VOLATILITY, false, CompositeRegimeType.BEAR],
      [MarketRegimeType.EXTREME, false, CompositeRegimeType.EXTREME]
    ])('should classify %s + aboveSma=%s as %s', (volatility, aboveSma, expected) => {
      expect(service.classifyComposite(volatility, aboveSma as boolean)).toBe(expected);
    });
  });
});
