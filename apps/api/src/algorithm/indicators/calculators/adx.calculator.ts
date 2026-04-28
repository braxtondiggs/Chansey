import { ADX } from 'technicalindicators';

import { BaseIndicatorCalculator } from './base-indicator.calculator';

import { type CalculatorADXOptions, type CalculatorADXResult } from '../indicator.interface';

/**
 * Average Directional Index (ADX) Calculator
 *
 * Measures trend strength on a 0-100 scale, regardless of direction. Common readings:
 * - 0-20: weak / non-trending
 * - 20-25: emerging trend
 * - 25-50: strong trend
 * - 50+: very strong trend
 *
 * Used here as a flat-tape filter so trend strategies sit out non-trending markets.
 * Returns +DI / -DI alongside ADX so downstream callers can audit directional bias.
 */
export class ADXCalculator extends BaseIndicatorCalculator<CalculatorADXOptions, CalculatorADXResult> {
  readonly id = 'adx';
  readonly name = 'Average Directional Index';

  calculate(options: CalculatorADXOptions): CalculatorADXResult {
    this.validateOptions(options);

    const { high, low, close, period } = options;
    const raw = ADX.calculate({ high, low, close, period });
    const adx: number[] = [];
    const pdi: number[] = [];
    const mdi: number[] = [];
    for (const r of raw) {
      adx.push(Number.isFinite(r.adx) ? r.adx : NaN);
      pdi.push(Number.isFinite(r.pdi) ? r.pdi : NaN);
      mdi.push(Number.isFinite(r.mdi) ? r.mdi : NaN);
    }
    return { adx, pdi, mdi };
  }

  getWarmupPeriod(options: Partial<CalculatorADXOptions>): number {
    const period = options.period ?? 14;
    // ADX needs ~2*period bars before first valid output (smoothed +DI/-DI then smoothed ADX)
    return period * 2;
  }

  validateOptions(options: CalculatorADXOptions): void {
    this.validatePeriod(options.period);

    if (!options.high || !options.low || !options.close) {
      throw new Error('ADX requires high, low, and close price arrays');
    }

    if (options.high.length !== options.low.length || options.low.length !== options.close.length) {
      throw new Error(
        `Array lengths must match: high=${options.high.length}, low=${options.low.length}, close=${options.close.length}`
      );
    }

    this.validateDataLength(options.high, options.period * 2);
    this.validateNumericValues(options.high);
    this.validateNumericValues(options.low);
    this.validateNumericValues(options.close);
  }
}

/**
 * Tier classification for ADX trend-strength gates.
 * - `absent`: ADX < 20 — no clear trend, sit out.
 * - `weak`:   20 ≤ ADX < 25 — emerging trend, reduced sizing tier.
 * - `strong`: ADX ≥ 25 — confirmed trend, full sizing tier.
 */
export type AdxTrendStrength = 'absent' | 'weak' | 'strong';

export function classifyAdxTrend(adx: number): AdxTrendStrength {
  if (!Number.isFinite(adx) || adx < 20) return 'absent';
  if (adx < 25) return 'weak';
  return 'strong';
}
