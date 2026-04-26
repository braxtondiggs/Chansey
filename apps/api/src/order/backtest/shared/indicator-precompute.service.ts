import { Injectable, Logger } from '@nestjs/common';

import { PriceTrackingContext } from './price-window';

import {
  ATRCalculator,
  BollingerBandsCalculator,
  EMACalculator,
  MACDCalculator,
  RSICalculator,
  SMACalculator
} from '../../../algorithm/indicators/calculators';
import { AlgorithmRegistry } from '../../../algorithm/registry/algorithm-registry.service';
import { Coin } from '../../../coin/coin.entity';

@Injectable()
export class IndicatorPrecomputeService {
  private readonly logger = new Logger('IndicatorPrecomputeService');

  constructor(private readonly algorithmRegistry: AlgorithmRegistry) {}

  /**
   * Precompute indicator series for all coins ONCE before the timestamp loop.
   * Eliminates per-timestamp IndicatorService calls (MD5 hashing + Redis I/O).
   * Returns a map: coinId -> indicatorKey -> full padded number array.
   */
  async precomputeIndicators(
    algorithmId: string,
    parameters: Record<string, unknown>,
    coins: Coin[],
    priceCtx: PriceTrackingContext
  ): Promise<Record<string, Record<string, Float64Array>> | undefined> {
    let strategy;
    try {
      strategy = await this.algorithmRegistry.getStrategyForAlgorithm(algorithmId);
    } catch {
      return undefined;
    }
    if (!strategy?.getIndicatorRequirements) return undefined;

    const requirements = strategy.getIndicatorRequirements(parameters);
    if (requirements.length === 0) return undefined;

    const result: Record<string, Record<string, Float64Array>> = {};

    // Instantiate calculators once
    const emaCalc = new EMACalculator();
    const smaCalc = new SMACalculator();
    const rsiCalc = new RSICalculator();
    const macdCalc = new MACDCalculator();
    const bbCalc = new BollingerBandsCalculator();
    const atrCalc = new ATRCalculator();

    for (const coin of coins) {
      const summaries = priceCtx.summariesByCoin.get(coin.id);
      if (!summaries || summaries.length === 0) continue;

      const coinIndicators: Record<string, Float64Array> = {};
      const avgPrices = summaries.map((s) => s.avg);
      const highPrices = summaries.map((s) => s.high);
      const lowPrices = summaries.map((s) => s.low);

      for (const req of requirements) {
        // Resolve parameter values from config, falling back to defaults
        const resolveParam = (key: string): number => {
          const val = parameters[key];
          return typeof val === 'number' && isFinite(val) ? val : req.defaultParams[key];
        };

        try {
          switch (req.type) {
            case 'EMA': {
              const periodKey = req.paramKeys[0];
              const period = resolveParam(periodKey);
              const key = `ema_${period}`;
              if (!coinIndicators[key] && avgPrices.length >= period) {
                const raw = emaCalc.calculate({ values: avgPrices, period });
                coinIndicators[key] = this.padIndicatorArray(raw, avgPrices.length);
              }
              break;
            }
            case 'SMA': {
              const periodKey = req.paramKeys[0];
              const period = resolveParam(periodKey);
              const key = `sma_${period}`;
              if (!coinIndicators[key] && avgPrices.length >= period) {
                const raw = smaCalc.calculate({ values: avgPrices, period });
                coinIndicators[key] = this.padIndicatorArray(raw, avgPrices.length);
              }
              break;
            }
            case 'RSI': {
              const periodKey = req.paramKeys[0];
              const period = resolveParam(periodKey);
              const key = `rsi_${period}`;
              if (!coinIndicators[key] && avgPrices.length > period) {
                const raw = rsiCalc.calculate({ values: avgPrices, period });
                coinIndicators[key] = this.padIndicatorArray(raw, avgPrices.length);
              }
              break;
            }
            case 'MACD': {
              const fast = resolveParam(req.paramKeys[0]);
              const slow = resolveParam(req.paramKeys[1]);
              const signal = resolveParam(req.paramKeys[2]);
              const baseKey = `macd_${fast}_${slow}_${signal}`;
              if (!coinIndicators[`${baseKey}_macd`] && avgPrices.length >= slow + signal - 1) {
                const raw = macdCalc.calculate({
                  values: avgPrices,
                  fastPeriod: fast,
                  slowPeriod: slow,
                  signalPeriod: signal
                });
                const len = avgPrices.length;
                coinIndicators[`${baseKey}_macd`] = this.padIndicatorArray(
                  raw.map((r) => r.MACD ?? NaN),
                  len
                );
                coinIndicators[`${baseKey}_signal`] = this.padIndicatorArray(
                  raw.map((r) => r.signal ?? NaN),
                  len
                );
                coinIndicators[`${baseKey}_histogram`] = this.padIndicatorArray(
                  raw.map((r) => r.histogram ?? NaN),
                  len
                );
              }
              break;
            }
            case 'BOLLINGER_BANDS': {
              const period = resolveParam(req.paramKeys[0]);
              const stdDev = resolveParam(req.paramKeys[1]);
              const baseKey = `bb_${period}_${stdDev}`;
              if (!coinIndicators[`${baseKey}_upper`] && avgPrices.length >= period) {
                const raw = bbCalc.calculate({ values: avgPrices, period, stdDev });
                const len = avgPrices.length;
                coinIndicators[`${baseKey}_upper`] = this.padIndicatorArray(
                  raw.map((r) => r.upper),
                  len
                );
                coinIndicators[`${baseKey}_middle`] = this.padIndicatorArray(
                  raw.map((r) => r.middle),
                  len
                );
                coinIndicators[`${baseKey}_lower`] = this.padIndicatorArray(
                  raw.map((r) => r.lower),
                  len
                );
                coinIndicators[`${baseKey}_pb`] = this.padIndicatorArray(
                  raw.map((r) => r.pb ?? NaN),
                  len
                );
                coinIndicators[`${baseKey}_bandwidth`] = this.padIndicatorArray(
                  raw.map((r) => (r.middle !== 0 ? (r.upper - r.lower) / r.middle : NaN)),
                  len
                );
              }
              break;
            }
            case 'ATR': {
              const periodKey = req.paramKeys[0];
              const period = resolveParam(periodKey);
              const key = `atr_${period}`;
              if (!coinIndicators[key] && avgPrices.length > period) {
                const raw = atrCalc.calculate({ high: highPrices, low: lowPrices, close: avgPrices, period });
                coinIndicators[key] = this.padIndicatorArray(raw, avgPrices.length);
              }
              break;
            }
          }
        } catch {
          // Skip indicators that fail to compute (e.g., insufficient data)
        }
      }

      if (Object.keys(coinIndicators).length > 0) {
        result[coin.id] = coinIndicators;
      }
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }

  /** Pad indicator results with NaN at the front to align with the full price series length. */
  padIndicatorArray(values: number[], targetLength: number): Float64Array {
    const padded = new Float64Array(targetLength);
    const padding = targetLength - values.length;
    if (padding > 0) {
      padded.fill(NaN, 0, padding);
    }
    padded.set(padding > 0 ? values : values.slice(0, targetLength), Math.max(0, padding));
    return padded;
  }
}
