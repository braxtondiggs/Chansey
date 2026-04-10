import {
  buildExitConfig,
  calculateConfidence,
  calculateSignalStrength,
  generateSignalFromConfluence
} from './confluence-signals.util';

import { StopLossType, TakeProfitType } from '../../order/interfaces/exit-config.interface';
import { type ConfluenceConfig, type ConfluenceScore, SignalType, type TradingSignal } from '../interfaces';

describe('Confluence Signals Utilities', () => {
  const makeConfig = (overrides: Partial<ConfluenceConfig> = {}): ConfluenceConfig =>
    ({
      minConfluence: 2,
      minSellConfluence: 2,
      minConfidence: 0.5,
      enableShortSignals: false,
      ema: { enabled: true, fastPeriod: 12, slowPeriod: 26 },
      rsi: { enabled: true, period: 14, buyThreshold: 55, sellThreshold: 45 },
      macd: { enabled: true, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
      atr: { enabled: true, period: 14, volatilityThresholdMultiplier: 2.0 },
      bollingerBands: { enabled: true, period: 20, stdDev: 2, buyThreshold: 0.55, sellThreshold: 0.45 },
      ...overrides
    }) as ConfluenceConfig;

  const makeScore = (overrides: Partial<ConfluenceScore> = {}): ConfluenceScore => ({
    direction: 'buy',
    confluenceCount: 3,
    totalEnabled: 4,
    signals: [
      { name: 'EMA', signal: 'bullish', strength: 0.7, reason: '', values: {} },
      { name: 'RSI', signal: 'bullish', strength: 0.6, reason: '', values: {} },
      { name: 'MACD', signal: 'bullish', strength: 0.8, reason: '', values: {} },
      { name: 'BB', signal: 'neutral', strength: 0.3, reason: '', values: {} }
    ],
    averageStrength: 0.7,
    isVolatilityFiltered: false,
    ...overrides
  });

  /** Helper: assert non-null and return typed value */
  const expectSignal = (result: TradingSignal | null): TradingSignal => {
    expect(result).not.toBeNull();
    return result as TradingSignal;
  };

  describe('generateSignalFromConfluence', () => {
    it('should return null when direction is hold', () => {
      const score = makeScore({ direction: 'hold' });
      const result = generateSignalFromConfluence('btc', 'BTC', 50000, score, makeConfig());
      expect(result).toBeNull();
    });

    it('should return null when confidence is below minConfidence', () => {
      const score = makeScore({ confluenceCount: 1, totalEnabled: 4, averageStrength: 0.1 });
      const result = generateSignalFromConfluence('btc', 'BTC', 50000, score, makeConfig({ minConfidence: 0.99 }));
      expect(result).toBeNull();
    });

    it('should generate BUY signal for bullish direction', () => {
      const signal = expectSignal(generateSignalFromConfluence('btc', 'BTC', 50000, makeScore(), makeConfig()));
      expect(signal.type).toBe(SignalType.BUY);
      expect(signal.coinId).toBe('btc');
      expect(signal.price).toBe(50000);
    });

    it('should generate SELL signal for bearish direction', () => {
      const score = makeScore({
        direction: 'sell',
        signals: [
          { name: 'EMA', signal: 'bearish', strength: 0.7, reason: '', values: {} },
          { name: 'RSI', signal: 'bearish', strength: 0.6, reason: '', values: {} },
          { name: 'MACD', signal: 'bearish', strength: 0.8, reason: '', values: {} },
          { name: 'BB', signal: 'neutral', strength: 0.3, reason: '', values: {} }
        ]
      });
      const signal = expectSignal(generateSignalFromConfluence('btc', 'BTC', 50000, score, makeConfig()));
      expect(signal.type).toBe(SignalType.SELL);
    });

    it('should generate SHORT_EXIT for bullish direction in futures short mode', () => {
      const signal = expectSignal(generateSignalFromConfluence('btc', 'BTC', 50000, makeScore(), makeConfig(), true));
      expect(signal.type).toBe(SignalType.SHORT_EXIT);
    });

    it('should generate SHORT_ENTRY for bearish direction in futures short mode', () => {
      const score = makeScore({
        direction: 'sell',
        signals: [
          { name: 'EMA', signal: 'bearish', strength: 0.7, reason: '', values: {} },
          { name: 'RSI', signal: 'bearish', strength: 0.6, reason: '', values: {} },
          { name: 'MACD', signal: 'bearish', strength: 0.8, reason: '', values: {} }
        ]
      });
      const signal = expectSignal(generateSignalFromConfluence('btc', 'BTC', 50000, score, makeConfig(), true));
      expect(signal.type).toBe(SignalType.SHORT_ENTRY);
    });

    it('should include agreeing indicators in metadata', () => {
      const signal = expectSignal(generateSignalFromConfluence('btc', 'BTC', 50000, makeScore(), makeConfig()));
      const agreeing = (signal.metadata as Record<string, unknown>).agreeingIndicators as string[];
      expect(agreeing).toEqual(['EMA', 'RSI', 'MACD']);
    });

    it('should include exitConfig in the signal', () => {
      const signal = expectSignal(generateSignalFromConfluence('btc', 'BTC', 50000, makeScore(), makeConfig()));
      expect(signal.exitConfig).toBeDefined();
      expect((signal.exitConfig as Record<string, unknown>).enableStopLoss).toBe(true);
    });
  });

  describe('buildExitConfig', () => {
    it('should produce tighter stop loss for higher confluence ratio', () => {
      const highConfluence = buildExitConfig(makeScore({ confluenceCount: 4, totalEnabled: 4 }));
      const lowConfluence = buildExitConfig(makeScore({ confluenceCount: 2, totalEnabled: 4 }));
      expect(highConfluence.stopLossValue as number).toBeLessThan(lowConfluence.stopLossValue as number);
    });

    it('should produce wider take profit for higher confluence ratio', () => {
      const highConfluence = buildExitConfig(makeScore({ confluenceCount: 4, totalEnabled: 4 }));
      const lowConfluence = buildExitConfig(makeScore({ confluenceCount: 2, totalEnabled: 4 }));
      expect(highConfluence.takeProfitValue as number).toBeGreaterThan(lowConfluence.takeProfitValue as number);
    });

    it('should set correct types and flags', () => {
      const config = buildExitConfig(makeScore());
      expect(config.stopLossType).toBe(StopLossType.PERCENTAGE);
      expect(config.takeProfitType).toBe(TakeProfitType.RISK_REWARD);
      expect(config.useOco).toBe(true);
      expect(config.enableTrailingStop).toBe(false);
    });

    it('should handle zero totalEnabled gracefully', () => {
      const config = buildExitConfig(makeScore({ totalEnabled: 0, confluenceCount: 0 }));
      expect(config.stopLossValue).toBeGreaterThanOrEqual(1);
      expect(config.takeProfitValue).toBeGreaterThanOrEqual(1);
    });
  });

  describe('calculateSignalStrength', () => {
    it('should blend 60% strength + 40% confluence ratio', () => {
      const score = makeScore({ averageStrength: 1.0, confluenceCount: 4, totalEnabled: 4 });
      const strength = calculateSignalStrength(score);
      // 1.0 * 0.6 + 1.0 * 0.4 = 1.0
      expect(strength).toBe(1);
    });

    it('should cap at 1.0', () => {
      const score = makeScore({ averageStrength: 1.0, confluenceCount: 4, totalEnabled: 4 });
      expect(calculateSignalStrength(score)).toBeLessThanOrEqual(1);
    });

    it('should return 0 when no indicators agree', () => {
      const score = makeScore({ averageStrength: 0, confluenceCount: 0, totalEnabled: 0 });
      expect(calculateSignalStrength(score)).toBe(0);
    });
  });

  describe('calculateConfidence', () => {
    it('should increase with higher confluence ratio', () => {
      const low = calculateConfidence(
        makeScore({ confluenceCount: 2, totalEnabled: 4, averageStrength: 0.5 }),
        makeConfig()
      );
      const high = calculateConfidence(
        makeScore({ confluenceCount: 4, totalEnabled: 4, averageStrength: 0.5 }),
        makeConfig()
      );
      expect(high).toBeGreaterThan(low);
    });

    it('should add 10% bonus per extra indicator above minConfluence', () => {
      const atMin = calculateConfidence(
        makeScore({ confluenceCount: 2, totalEnabled: 4, averageStrength: 0.5 }),
        makeConfig({ minConfluence: 2 })
      );
      const oneAbove = calculateConfidence(
        makeScore({ confluenceCount: 3, totalEnabled: 4, averageStrength: 0.5 }),
        makeConfig({ minConfluence: 2 })
      );
      expect(oneAbove - atMin).toBeCloseTo(0.1 + 0.1, 1); // +0.1 bonus + ratio increase
    });

    it('should cap at 1.0', () => {
      const score = makeScore({ confluenceCount: 5, totalEnabled: 5, averageStrength: 1.0 });
      expect(calculateConfidence(score, makeConfig({ minConfluence: 1 }))).toBeLessThanOrEqual(1);
    });

    it('should use minSellConfluence for sell signal bonus instead of minConfluence', () => {
      const config = makeConfig({ minConfluence: 2, minSellConfluence: 3 });
      const sellScore = makeScore({ direction: 'sell', confluenceCount: 3, totalEnabled: 4, averageStrength: 0.5 });
      const sellConfidence = calculateConfidence(sellScore, config);

      const buyScore = makeScore({ direction: 'buy', confluenceCount: 3, totalEnabled: 4, averageStrength: 0.5 });
      const buyConfidence = calculateConfidence(buyScore, config);

      // Sell with count=3, minSellConfluence=3 → excess=0, no bonus
      // Buy with count=3, minConfluence=2 → excess=1, +10% bonus
      expect(buyConfidence).toBeGreaterThan(sellConfidence);
    });

    it('should include strength contribution up to 20%', () => {
      const noStrength = calculateConfidence(
        makeScore({ averageStrength: 0, confluenceCount: 2, totalEnabled: 4 }),
        makeConfig()
      );
      const fullStrength = calculateConfidence(
        makeScore({ averageStrength: 1.0, confluenceCount: 2, totalEnabled: 4 }),
        makeConfig()
      );
      expect(fullStrength - noStrength).toBeCloseTo(0.2, 1);
    });
  });
});
