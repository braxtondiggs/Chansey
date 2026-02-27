import {
  calculateStopLossPrice,
  calculateTakeProfitPrice,
  calculateTrailingActivationPrice,
  calculateTrailingStopPrice,
  computeAtrFromOHLC,
  DEFAULT_BACKTEST_EXIT_CONFIG
} from './exit-price.utils';

import {
  ExitConfig,
  StopLossType,
  TakeProfitType,
  TrailingActivationType,
  TrailingType
} from '../../../interfaces/exit-config.interface';

function makeConfig(overrides: Partial<ExitConfig> = {}): ExitConfig {
  return { ...DEFAULT_BACKTEST_EXIT_CONFIG, ...overrides };
}

describe('exit-price.utils', () => {
  describe('calculateStopLossPrice', () => {
    it('FIXED: returns the configured absolute price regardless of side', () => {
      const config = makeConfig({ stopLossType: StopLossType.FIXED, stopLossValue: 45000 });
      expect(calculateStopLossPrice(50000, 'BUY', config)).toBe(45000);
      expect(calculateStopLossPrice(50000, 'SELL', config)).toBe(45000);
    });

    it('PERCENTAGE: BUY — stop below entry', () => {
      const config = makeConfig({ stopLossType: StopLossType.PERCENTAGE, stopLossValue: 5 });
      expect(calculateStopLossPrice(100, 'BUY', config)).toBe(95);
    });

    it('PERCENTAGE: SELL — stop above entry', () => {
      const config = makeConfig({ stopLossType: StopLossType.PERCENTAGE, stopLossValue: 5 });
      expect(calculateStopLossPrice(100, 'SELL', config)).toBe(105);
    });

    it('ATR: uses ATR multiplier for BUY', () => {
      const config = makeConfig({ stopLossType: StopLossType.ATR, stopLossValue: 2 });
      expect(calculateStopLossPrice(50000, 'BUY', config, 500)).toBe(49000);
    });

    it('ATR: uses ATR multiplier for SELL', () => {
      const config = makeConfig({ stopLossType: StopLossType.ATR, stopLossValue: 2 });
      expect(calculateStopLossPrice(50000, 'SELL', config, 500)).toBe(51000);
    });

    it.each([undefined, NaN])('ATR: falls back to 2%% when ATR is %s', (atr) => {
      const config = makeConfig({ stopLossType: StopLossType.ATR, stopLossValue: 2 });
      expect(calculateStopLossPrice(1000, 'BUY', config, atr)).toBe(980);
    });

    it('default: falls back to 2% for unknown type', () => {
      const config = makeConfig({ stopLossType: 'UNKNOWN' as StopLossType, stopLossValue: 99 });
      // 2% of 1000 = 20 → 980
      expect(calculateStopLossPrice(1000, 'BUY', config)).toBe(980);
    });
  });

  describe('calculateTakeProfitPrice', () => {
    it('FIXED: returns the configured absolute price', () => {
      const config = makeConfig({ takeProfitType: TakeProfitType.FIXED, takeProfitValue: 60000 });
      expect(calculateTakeProfitPrice(50000, 'BUY', config)).toBe(60000);
    });

    it('PERCENTAGE: BUY — profit above entry', () => {
      const config = makeConfig({ takeProfitType: TakeProfitType.PERCENTAGE, takeProfitValue: 10 });
      expect(calculateTakeProfitPrice(100, 'BUY', config)).toBe(110);
    });

    it('PERCENTAGE: SELL — profit below entry', () => {
      const config = makeConfig({ takeProfitType: TakeProfitType.PERCENTAGE, takeProfitValue: 10 });
      expect(calculateTakeProfitPrice(100, 'SELL', config)).toBe(90);
    });

    it('RISK_REWARD: BUY with SL price', () => {
      const config = makeConfig({ takeProfitType: TakeProfitType.RISK_REWARD, takeProfitValue: 2 });
      // risk = |100 - 95| = 5, reward = 5 * 2 = 10 → TP at 110
      expect(calculateTakeProfitPrice(100, 'BUY', config, 95)).toBe(110);
    });

    it('RISK_REWARD: SELL with SL price', () => {
      const config = makeConfig({ takeProfitType: TakeProfitType.RISK_REWARD, takeProfitValue: 2 });
      // risk = |100 - 105| = 5, reward = 5 * 2 = 10 → TP at 90
      expect(calculateTakeProfitPrice(100, 'SELL', config, 105)).toBe(90);
    });

    it('RISK_REWARD: without SL price falls back to 4%', () => {
      const config = makeConfig({ takeProfitType: TakeProfitType.RISK_REWARD, takeProfitValue: 2 });
      // 4% of 100 = 4 → TP at 104
      expect(calculateTakeProfitPrice(100, 'BUY', config)).toBe(104);
    });

    it('default: falls back to 4% for unknown type', () => {
      const config = makeConfig({ takeProfitType: 'UNKNOWN' as TakeProfitType, takeProfitValue: 99 });
      // 4% of 1000 = 40 → 1040
      expect(calculateTakeProfitPrice(1000, 'BUY', config)).toBe(1040);
    });
  });

  describe('calculateTrailingStopPrice', () => {
    it('AMOUNT: fixed dollar distance below entry for BUY', () => {
      const config = makeConfig({ trailingType: TrailingType.AMOUNT, trailingValue: 50 });
      expect(calculateTrailingStopPrice(1000, 'BUY', config)).toBe(950);
    });

    it('AMOUNT: fixed dollar distance above entry for SELL', () => {
      const config = makeConfig({ trailingType: TrailingType.AMOUNT, trailingValue: 50 });
      expect(calculateTrailingStopPrice(1000, 'SELL', config)).toBe(1050);
    });

    it('PERCENTAGE: BUY — trailing below entry', () => {
      const config = makeConfig({ trailingType: TrailingType.PERCENTAGE, trailingValue: 2 });
      expect(calculateTrailingStopPrice(1000, 'BUY', config)).toBe(980);
    });

    it('PERCENTAGE: SELL — trailing above entry', () => {
      const config = makeConfig({ trailingType: TrailingType.PERCENTAGE, trailingValue: 2 });
      expect(calculateTrailingStopPrice(1000, 'SELL', config)).toBe(1020);
    });

    it('ATR: uses ATR for trailing distance', () => {
      const config = makeConfig({ trailingType: TrailingType.ATR, trailingValue: 3 });
      expect(calculateTrailingStopPrice(1000, 'BUY', config, 100)).toBe(700);
    });

    it('ATR: falls back to 1% when ATR unavailable', () => {
      const config = makeConfig({ trailingType: TrailingType.ATR, trailingValue: 3 });
      expect(calculateTrailingStopPrice(1000, 'BUY', config)).toBe(990);
    });

    it('default: falls back to 1% for unknown type', () => {
      const config = makeConfig({ trailingType: 'UNKNOWN' as TrailingType, trailingValue: 99 });
      // 1% of 1000 = 10 → 990
      expect(calculateTrailingStopPrice(1000, 'BUY', config)).toBe(990);
    });
  });

  describe('calculateTrailingActivationPrice', () => {
    it('IMMEDIATE: returns entry price', () => {
      const config = makeConfig({ trailingActivation: TrailingActivationType.IMMEDIATE });
      expect(calculateTrailingActivationPrice(100, 'BUY', config)).toBe(100);
    });

    it('PRICE: returns the configured activation price', () => {
      const config = makeConfig({
        trailingActivation: TrailingActivationType.PRICE,
        trailingActivationValue: 110
      });
      expect(calculateTrailingActivationPrice(100, 'BUY', config)).toBe(110);
    });

    it('PRICE: falls back to entry when activationValue is 0', () => {
      const config = makeConfig({
        trailingActivation: TrailingActivationType.PRICE,
        trailingActivationValue: 0
      });
      expect(calculateTrailingActivationPrice(100, 'BUY', config)).toBe(100);
    });

    it('PERCENTAGE: BUY — activation above entry', () => {
      const config = makeConfig({
        trailingActivation: TrailingActivationType.PERCENTAGE,
        trailingActivationValue: 5
      });
      expect(calculateTrailingActivationPrice(100, 'BUY', config)).toBe(105);
    });

    it('PERCENTAGE: SELL — activation below entry', () => {
      const config = makeConfig({
        trailingActivation: TrailingActivationType.PERCENTAGE,
        trailingActivationValue: 5
      });
      expect(calculateTrailingActivationPrice(100, 'SELL', config)).toBe(95);
    });
  });

  describe('computeAtrFromOHLC', () => {
    it('returns undefined when insufficient data', () => {
      expect(computeAtrFromOHLC([110, 112], [90, 88], [100, 105], 14)).toBeUndefined();
    });

    it('computes ATR from valid OHLC data', () => {
      // 20 bars with constant 10-wide range → ATR should be exactly 10
      const bars = 20;
      const highs: number[] = [];
      const lows: number[] = [];
      const closes: number[] = [];
      for (let i = 0; i < bars; i++) {
        const base = 100 + i;
        highs.push(base + 5);
        lows.push(base - 5);
        closes.push(base);
      }
      expect(computeAtrFromOHLC(highs, lows, closes, 14)).toBe(10);
    });
  });

  describe('DEFAULT_BACKTEST_EXIT_CONFIG', () => {
    it('matches legacy 5% stop-loss behavior', () => {
      expect(DEFAULT_BACKTEST_EXIT_CONFIG).toMatchObject({
        enableStopLoss: true,
        stopLossType: StopLossType.PERCENTAGE,
        stopLossValue: 5,
        enableTakeProfit: false,
        enableTrailingStop: false,
        useOco: false
      });
    });
  });
});
