import { type CandleData } from '../../ohlc/ohlc-candle.entity';
import { type IIndicatorProvider, type IndicatorService } from '../indicators';
import { type AlgorithmContext, type ConfluenceConfig } from '../interfaces';

export interface ResolvedIndicators {
  ema12: number[] | null;
  ema26: number[] | null;
  rsi: number[] | null;
  macd: number[] | null;
  macdSignal: number[] | null;
  macdHistogram: number[] | null;
  atr: number[] | null;
  bbPb: number[] | null;
  bbBandwidth: number[] | null;
}

export interface ResolveIndicatorDataOptions {
  config: ConfluenceConfig;
  coinId: string;
  prices: CandleData[];
  skipCache: boolean;
  getPrecomputedSlice: (context: AlgorithmContext, coinId: string, key: string, len: number) => number[] | undefined;
  indicatorService: IndicatorService;
  indicatorProvider: IIndicatorProvider;
  context: AlgorithmContext;
}

/**
 * Resolve indicator data via precomputed slices (fast-path) or IndicatorService (fallback).
 */
export async function resolveIndicatorData(options: ResolveIndicatorDataOptions): Promise<ResolvedIndicators> {
  const { config, coinId, prices, skipCache, getPrecomputedSlice, indicatorService, indicatorProvider, context } =
    options;
  const windowLength = prices.length;

  let ema12: number[] | null = null;
  let ema26: number[] | null = null;
  let rsi: number[] | null = null;
  let macd: number[] | null = null;
  let macdSignal: number[] | null = null;
  let macdHistogram: number[] | null = null;
  let atr: number[] | null = null;
  let bbPb: number[] | null = null;
  let bbBandwidth: number[] | null = null;

  // --- Precomputed lookups ---
  if (config.ema.enabled) {
    const preEma12 = getPrecomputedSlice(context, coinId, `ema_${config.ema.fastPeriod}`, windowLength);
    const preEma26 = getPrecomputedSlice(context, coinId, `ema_${config.ema.slowPeriod}`, windowLength);
    if (preEma12 && preEma26) {
      ema12 = preEma12;
      ema26 = preEma26;
    }
  }

  if (config.rsi.enabled) {
    const preRsi = getPrecomputedSlice(context, coinId, `rsi_${config.rsi.period}`, windowLength);
    if (preRsi) {
      rsi = preRsi;
    }
  }

  if (config.macd.enabled) {
    const macdKey = `macd_${config.macd.fastPeriod}_${config.macd.slowPeriod}_${config.macd.signalPeriod}`;
    const preMacd = getPrecomputedSlice(context, coinId, `${macdKey}_macd`, windowLength);
    const preMacdSignal = getPrecomputedSlice(context, coinId, `${macdKey}_signal`, windowLength);
    const preMacdHistogram = getPrecomputedSlice(context, coinId, `${macdKey}_histogram`, windowLength);
    if (preMacd && preMacdSignal && preMacdHistogram) {
      macd = preMacd;
      macdSignal = preMacdSignal;
      macdHistogram = preMacdHistogram;
    }
  }

  if (config.atr.enabled) {
    const preAtr = getPrecomputedSlice(context, coinId, `atr_${config.atr.period}`, windowLength);
    if (preAtr) {
      atr = preAtr;
    }
  }

  if (config.bollingerBands.enabled) {
    const bbKey = `bb_${config.bollingerBands.period}_${config.bollingerBands.stdDev}`;
    const prePb = getPrecomputedSlice(context, coinId, `${bbKey}_pb`, windowLength);
    const preBandwidth = getPrecomputedSlice(context, coinId, `${bbKey}_bandwidth`, windowLength);
    if (prePb && preBandwidth) {
      bbPb = prePb;
      bbBandwidth = preBandwidth;
    }
  }

  // --- IndicatorService fallback for any indicators not precomputed ---
  const needsEma = config.ema.enabled && !ema12;
  const needsRsi = config.rsi.enabled && !rsi;
  const needsMacd = config.macd.enabled && !macd;
  const needsAtr = config.atr.enabled && !atr;
  const needsBb = config.bollingerBands.enabled && !bbPb;

  if (needsEma || needsRsi || needsMacd || needsAtr || needsBb) {
    const [ema12Result, ema26Result, rsiResult, macdResult, atrResult, bbResult] = await Promise.all([
      needsEma
        ? indicatorService.calculateEMA({ coinId, prices, period: config.ema.fastPeriod, skipCache }, indicatorProvider)
        : null,
      needsEma
        ? indicatorService.calculateEMA({ coinId, prices, period: config.ema.slowPeriod, skipCache }, indicatorProvider)
        : null,
      needsRsi
        ? indicatorService.calculateRSI({ coinId, prices, period: config.rsi.period, skipCache }, indicatorProvider)
        : null,
      needsMacd
        ? indicatorService.calculateMACD(
            {
              coinId,
              prices,
              fastPeriod: config.macd.fastPeriod,
              slowPeriod: config.macd.slowPeriod,
              signalPeriod: config.macd.signalPeriod,
              skipCache
            },
            indicatorProvider
          )
        : null,
      needsAtr
        ? indicatorService.calculateATR({ coinId, prices, period: config.atr.period, skipCache }, indicatorProvider)
        : null,
      needsBb
        ? indicatorService.calculateBollingerBands(
            {
              coinId,
              prices,
              period: config.bollingerBands.period,
              stdDev: config.bollingerBands.stdDev,
              skipCache
            },
            indicatorProvider
          )
        : null
    ]);

    if (needsEma && ema12Result && ema26Result) {
      ema12 = ema12Result.values;
      ema26 = ema26Result.values;
    }
    if (needsRsi && rsiResult) {
      rsi = rsiResult.values;
    }
    if (needsMacd && macdResult) {
      macd = macdResult.macd;
      macdSignal = macdResult.signal;
      macdHistogram = macdResult.histogram;
    }
    if (needsAtr && atrResult) {
      atr = atrResult.values;
    }
    if (needsBb && bbResult) {
      bbPb = bbResult.pb;
      bbBandwidth = bbResult.bandwidth;
    }
  }

  return { ema12, ema26, rsi, macd, macdSignal, macdHistogram, atr, bbPb, bbBandwidth };
}
