import { ADX } from 'technicalindicators';

import { ADXCalculator, classifyAdxTrend } from './adx.calculator';

describe('ADXCalculator', () => {
  let calculator: ADXCalculator;

  beforeEach(() => {
    calculator = new ADXCalculator();
  });

  it('exposes correct id and name', () => {
    expect(calculator.id).toBe('adx');
    expect(calculator.name).toBe('Average Directional Index');
  });

  it('warmup is 2 * period', () => {
    expect(calculator.getWarmupPeriod({ period: 14 })).toBe(28);
    expect(calculator.getWarmupPeriod({ period: 7 })).toBe(14);
  });

  it('warmup defaults to 28 when period is undefined', () => {
    expect(calculator.getWarmupPeriod({})).toBe(28);
  });

  it('matches technicalindicators ADX/+DI/-DI output for a synthetic uptrend', () => {
    const len = 60;
    const high: number[] = [];
    const low: number[] = [];
    const close: number[] = [];
    for (let i = 0; i < len; i++) {
      const base = 100 + i * 0.8;
      high.push(base + 1);
      low.push(base - 1);
      close.push(base);
    }

    const ours = calculator.calculate({ high, low, close, period: 14 });
    const reference = ADX.calculate({ high, low, close, period: 14 });

    expect(ours.adx.length).toBe(reference.length);
    expect(ours.pdi.length).toBe(reference.length);
    expect(ours.mdi.length).toBe(reference.length);

    for (let i = 0; i < ours.adx.length; i++) {
      const refAdx = reference[i].adx;
      const refPdi = reference[i].pdi;
      const refMdi = reference[i].mdi;
      if (Number.isFinite(refAdx)) {
        expect(ours.adx[i]).toBeCloseTo(refAdx, 6);
      } else {
        expect(Number.isFinite(ours.adx[i])).toBe(false);
      }
      if (Number.isFinite(refPdi)) expect(ours.pdi[i]).toBeCloseTo(refPdi, 6);
      if (Number.isFinite(refMdi)) expect(ours.mdi[i]).toBeCloseTo(refMdi, 6);
    }
  });

  it('returns higher ADX in a strong trend than in a flat range', () => {
    const len = 80;
    const trendHigh: number[] = [];
    const trendLow: number[] = [];
    const trendClose: number[] = [];
    const flatHigh: number[] = [];
    const flatLow: number[] = [];
    const flatClose: number[] = [];

    for (let i = 0; i < len; i++) {
      const trendBase = 100 + i * 1.5;
      trendHigh.push(trendBase + 1);
      trendLow.push(trendBase - 1);
      trendClose.push(trendBase);

      const flatBase = 100 + Math.sin(i / 3) * 0.5;
      flatHigh.push(flatBase + 0.6);
      flatLow.push(flatBase - 0.6);
      flatClose.push(flatBase);
    }

    const trendAdx = calculator.calculate({ high: trendHigh, low: trendLow, close: trendClose, period: 14 });
    const flatAdx = calculator.calculate({ high: flatHigh, low: flatLow, close: flatClose, period: 14 });

    const last = (arr: number[]) => arr.filter(Number.isFinite).slice(-1)[0];
    expect(last(trendAdx.adx)).toBeGreaterThan(last(flatAdx.adx));
  });

  it('throws when high/low/close arrays are missing', () => {
    expect(() => calculator.calculate({ low: [1, 2], close: [1, 2], period: 1 } as never)).toThrow(
      /ADX requires high, low, and close price arrays/
    );
  });

  it('throws on mismatched array lengths', () => {
    expect(() => calculator.calculate({ high: [1, 2, 3], low: [1, 2], close: [1, 2, 3], period: 1 })).toThrow(
      /Array lengths must match/
    );
  });

  it('throws on non-positive period', () => {
    expect(() => calculator.calculate({ high: [1, 2], low: [1, 2], close: [1, 2], period: 0 })).toThrow(
      /period must be a positive integer/
    );
  });

  it('throws on insufficient data', () => {
    expect(() => calculator.calculate({ high: [1, 2, 3], low: [1, 2, 3], close: [1, 2, 3], period: 14 })).toThrow(
      /Insufficient data/
    );
  });

  describe('classifyAdxTrend', () => {
    it('returns "absent" below 20', () => {
      expect(classifyAdxTrend(0)).toBe('absent');
      expect(classifyAdxTrend(15)).toBe('absent');
      expect(classifyAdxTrend(19)).toBe('absent');
      expect(classifyAdxTrend(19.999)).toBe('absent');
    });

    it('returns "weak" between 20 (inclusive) and 25 (exclusive)', () => {
      expect(classifyAdxTrend(20)).toBe('weak');
      expect(classifyAdxTrend(22)).toBe('weak');
      expect(classifyAdxTrend(24)).toBe('weak');
      expect(classifyAdxTrend(24.999)).toBe('weak');
    });

    it('returns "strong" at 25 and above', () => {
      expect(classifyAdxTrend(25)).toBe('strong');
      expect(classifyAdxTrend(40)).toBe('strong');
      expect(classifyAdxTrend(75)).toBe('strong');
    });

    it('treats NaN/Infinity as "absent"', () => {
      expect(classifyAdxTrend(NaN)).toBe('absent');
      expect(classifyAdxTrend(Infinity)).toBe('absent');
      expect(classifyAdxTrend(-Infinity)).toBe('absent');
    });
  });
});
