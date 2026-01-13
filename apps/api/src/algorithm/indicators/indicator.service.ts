import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { Cache } from 'cache-manager';

import * as crypto from 'crypto';

import {
  ATRCalculator,
  BollingerBandsCalculator,
  EMACalculator,
  MACDCalculator,
  RSICalculator,
  SMACalculator,
  StandardDeviationCalculator
} from './calculators';
import {
  ATROptions,
  ATRResult,
  BollingerBandsDataPoint,
  BollingerBandsOptions,
  BollingerBandsResult,
  IIndicatorProvider,
  IndicatorCalculatorMap,
  IndicatorResult,
  MACDDataPoint,
  MACDOptions,
  MACDResult,
  PeriodIndicatorOptions
} from './indicator.interface';
import { INDICATOR_CACHE_CONFIG, IndicatorType } from './indicator.types';

import { PriceSummary } from '../../ohlc/ohlc-candle.entity';
import { IndicatorDataTransformer } from '../utils/indicator-data-transformer';

/**
 * Centralized Indicator Service
 *
 * Provides a unified API for calculating technical indicators with:
 * - Caching support (L1 in-memory, L2 Redis)
 * - Custom calculator override support via IIndicatorProvider
 * - Consistent error handling and validation
 * - Automatic result padding for data alignment
 *
 * @example
 * // Basic usage
 * const ema = await indicatorService.calculateEMA({
 *   coinId: 'btc',
 *   prices: priceHistory,
 *   period: 12
 * });
 *
 * @example
 * // With custom calculator override
 * class MyStrategy implements IIndicatorProvider {
 *   getCustomCalculator(type) {
 *     if (type === 'ema') return new MyCustomEMACalculator();
 *   }
 * }
 * const ema = await indicatorService.calculateEMA(options, myStrategy);
 */
@Injectable()
export class IndicatorService {
  private readonly logger = new Logger(IndicatorService.name);

  // Default calculator instances stored in a typed registry
  private readonly calculators: IndicatorCalculatorMap = {
    sma: new SMACalculator(),
    ema: new EMACalculator(),
    rsi: new RSICalculator(),
    sd: new StandardDeviationCalculator(),
    macd: new MACDCalculator(),
    bollingerBands: new BollingerBandsCalculator(),
    atr: new ATRCalculator()
  };

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  /**
   * Calculate Simple Moving Average
   *
   * @param options - SMA calculation options
   * @param provider - Optional provider for custom calculator
   * @returns Indicator result with padded values
   */
  async calculateSMA(options: PeriodIndicatorOptions, provider?: IIndicatorProvider): Promise<IndicatorResult> {
    const calculator = this.getCalculator('sma', provider);
    const values = IndicatorDataTransformer.extractAveragePrices(options.prices);

    return this.calculatePeriodIndicator(IndicatorType.SMA, calculator, { values, period: options.period }, options);
  }

  /**
   * Calculate Exponential Moving Average
   *
   * @param options - EMA calculation options
   * @param provider - Optional provider for custom calculator
   * @returns Indicator result with padded values
   */
  async calculateEMA(options: PeriodIndicatorOptions, provider?: IIndicatorProvider): Promise<IndicatorResult> {
    const calculator = this.getCalculator('ema', provider);
    const values = IndicatorDataTransformer.extractAveragePrices(options.prices);

    return this.calculatePeriodIndicator(IndicatorType.EMA, calculator, { values, period: options.period }, options);
  }

  /**
   * Calculate Relative Strength Index
   *
   * @param options - RSI calculation options
   * @param provider - Optional provider for custom calculator
   * @returns Indicator result with padded values
   */
  async calculateRSI(options: PeriodIndicatorOptions, provider?: IIndicatorProvider): Promise<IndicatorResult> {
    const calculator = this.getCalculator('rsi', provider);
    const values = IndicatorDataTransformer.extractAveragePrices(options.prices);

    return this.calculatePeriodIndicator(IndicatorType.RSI, calculator, { values, period: options.period }, options);
  }

  /**
   * Calculate Standard Deviation
   *
   * @param options - SD calculation options
   * @param provider - Optional provider for custom calculator
   * @returns Indicator result with padded values
   */
  async calculateSD(options: PeriodIndicatorOptions, provider?: IIndicatorProvider): Promise<IndicatorResult> {
    const calculator = this.getCalculator('sd', provider);
    const values = IndicatorDataTransformer.extractAveragePrices(options.prices);

    return this.calculatePeriodIndicator(IndicatorType.SD, calculator, { values, period: options.period }, options);
  }

  /**
   * Calculate MACD (Moving Average Convergence Divergence)
   *
   * @param options - MACD calculation options
   * @param provider - Optional provider for custom calculator
   * @returns MACD result with macd, signal, and histogram arrays
   */
  async calculateMACD(options: MACDOptions, provider?: IIndicatorProvider): Promise<MACDResult> {
    const cacheKey = this.buildCacheKey(IndicatorType.MACD, options.coinId, options.prices, {
      fastPeriod: options.fastPeriod,
      slowPeriod: options.slowPeriod,
      signalPeriod: options.signalPeriod
    });

    // Check cache first
    if (!options.skipCache) {
      const cached = await this.getFromCache<MACDResult>(cacheKey);
      if (cached) {
        return { ...cached, fromCache: true };
      }
    }

    const calculator = this.getCalculator('macd', provider);
    const values = IndicatorDataTransformer.extractAveragePrices(options.prices);

    const rawResults = calculator.calculate({
      values,
      fastPeriod: options.fastPeriod,
      slowPeriod: options.slowPeriod,
      signalPeriod: options.signalPeriod
    }) as MACDDataPoint[];

    // Extract and pad each component
    const originalLength = options.prices.length;
    const result: MACDResult = {
      macd: this.padArray(
        rawResults.map((r) => r.MACD ?? NaN),
        originalLength
      ),
      signal: this.padArray(
        rawResults.map((r) => r.signal ?? NaN),
        originalLength
      ),
      histogram: this.padArray(
        rawResults.map((r) => r.histogram ?? NaN),
        originalLength
      ),
      validCount: rawResults.length,
      fastPeriod: options.fastPeriod,
      slowPeriod: options.slowPeriod,
      signalPeriod: options.signalPeriod,
      fromCache: false
    };

    await this.setInCache(cacheKey, result);
    return result;
  }

  /**
   * Calculate Bollinger Bands
   *
   * @param options - Bollinger Bands calculation options
   * @param provider - Optional provider for custom calculator
   * @returns Bollinger Bands result with upper, middle, lower, pb, and bandwidth arrays
   */
  async calculateBollingerBands(
    options: BollingerBandsOptions,
    provider?: IIndicatorProvider
  ): Promise<BollingerBandsResult> {
    const cacheKey = this.buildCacheKey(IndicatorType.BOLLINGER_BANDS, options.coinId, options.prices, {
      period: options.period,
      stdDev: options.stdDev
    });

    // Check cache first
    if (!options.skipCache) {
      const cached = await this.getFromCache<BollingerBandsResult>(cacheKey);
      if (cached) {
        return { ...cached, fromCache: true };
      }
    }

    const calculator = this.getCalculator('bollingerBands', provider);
    const values = IndicatorDataTransformer.extractAveragePrices(options.prices);

    const rawResults = calculator.calculate({
      values,
      period: options.period,
      stdDev: options.stdDev
    }) as BollingerBandsDataPoint[];

    // Extract and pad each component
    const originalLength = options.prices.length;
    const result: BollingerBandsResult = {
      upper: this.padArray(
        rawResults.map((r) => r.upper),
        originalLength
      ),
      middle: this.padArray(
        rawResults.map((r) => r.middle),
        originalLength
      ),
      lower: this.padArray(
        rawResults.map((r) => r.lower),
        originalLength
      ),
      pb: this.padArray(
        rawResults.map((r) => r.pb ?? NaN),
        originalLength
      ),
      bandwidth: this.padArray(
        rawResults.map((r) => r.bandwidth ?? NaN),
        originalLength
      ),
      validCount: rawResults.length,
      period: options.period,
      stdDev: options.stdDev,
      fromCache: false
    };

    await this.setInCache(cacheKey, result);
    return result;
  }

  /**
   * Calculate Average True Range
   *
   * @param options - ATR calculation options
   * @param provider - Optional provider for custom calculator
   * @returns ATR result with values array
   */
  async calculateATR(options: ATROptions, provider?: IIndicatorProvider): Promise<ATRResult> {
    const cacheKey = this.buildCacheKey(IndicatorType.ATR, options.coinId, options.prices, {
      period: options.period
    });

    // Check cache first
    if (!options.skipCache) {
      const cached = await this.getFromCache<ATRResult>(cacheKey);
      if (cached) {
        return { ...cached, fromCache: true };
      }
    }

    const calculator = this.getCalculator('atr', provider);

    // ATR needs OHLC data
    const high = IndicatorDataTransformer.extractHighPrices(options.prices);
    const low = IndicatorDataTransformer.extractLowPrices(options.prices);
    const close = IndicatorDataTransformer.extractAveragePrices(options.prices);

    const rawResults = calculator.calculate({
      high,
      low,
      close,
      period: options.period
    }) as number[];

    const result: ATRResult = {
      values: this.padArray(rawResults, options.prices.length),
      validCount: rawResults.length,
      period: options.period,
      fromCache: false
    };

    await this.setInCache(cacheKey, result);
    return result;
  }

  /**
   * Get the warmup period for a specific indicator type
   *
   * @param indicatorType - The type of indicator
   * @param options - Indicator-specific options
   * @returns The number of warmup data points needed
   */
  getWarmupPeriod(indicatorType: IndicatorType, options: Record<string, unknown>): number {
    switch (indicatorType) {
      case IndicatorType.SMA:
        return this.calculators.sma.getWarmupPeriod({ period: options['period'] as number });
      case IndicatorType.EMA:
        return this.calculators.ema.getWarmupPeriod({ period: options['period'] as number });
      case IndicatorType.RSI:
        return this.calculators.rsi.getWarmupPeriod({ period: options['period'] as number });
      case IndicatorType.SD:
        return this.calculators.sd.getWarmupPeriod({ period: options['period'] as number });
      case IndicatorType.MACD:
        return this.calculators.macd.getWarmupPeriod({
          slowPeriod: options['slowPeriod'] as number,
          signalPeriod: options['signalPeriod'] as number
        });
      case IndicatorType.BOLLINGER_BANDS:
        return this.calculators.bollingerBands.getWarmupPeriod({ period: options['period'] as number });
      case IndicatorType.ATR:
        return this.calculators.atr.getWarmupPeriod({ period: options['period'] as number });
      default:
        throw new Error(`Unknown indicator type: ${indicatorType}`);
    }
  }

  /**
   * Check if there is enough data for a specific indicator
   *
   * @param indicatorType - The type of indicator
   * @param dataLength - The number of data points available
   * @param options - Indicator-specific options
   * @returns True if there is enough data
   */
  hasEnoughData(indicatorType: IndicatorType, dataLength: number, options: Record<string, unknown>): boolean {
    const warmupPeriod = this.getWarmupPeriod(indicatorType, options);
    return dataLength > warmupPeriod;
  }

  /**
   * Calculate a period-based indicator (SMA, EMA, RSI, SD)
   */
  private async calculatePeriodIndicator(
    type: IndicatorType,
    calculator: IndicatorCalculatorMap['sma'],
    calcOptions: { values: number[]; period: number },
    options: PeriodIndicatorOptions
  ): Promise<IndicatorResult> {
    const cacheKey = this.buildCacheKey(type, options.coinId, options.prices, {
      period: options.period
    });

    // Check cache first
    if (!options.skipCache) {
      const cached = await this.getFromCache<IndicatorResult>(cacheKey);
      if (cached) {
        return { ...cached, fromCache: true };
      }
    }

    const rawResults = calculator.calculate(calcOptions);
    const paddedResults = this.padArray(rawResults, options.prices.length);

    const result: IndicatorResult = {
      values: paddedResults,
      validCount: rawResults.length,
      period: options.period,
      fromCache: false
    };

    await this.setInCache(cacheKey, result);
    return result;
  }

  /**
   * Get the appropriate calculator, checking for custom override
   */
  private getCalculator<T extends keyof IndicatorCalculatorMap>(
    type: T,
    provider?: IIndicatorProvider
  ): IndicatorCalculatorMap[T] {
    // Check for custom calculator from provider
    if (provider?.getCustomCalculator) {
      const customCalculator = provider.getCustomCalculator(type);
      if (customCalculator) {
        return customCalculator;
      }
    }

    // Return default calculator from registry
    const calculator = this.calculators[type];
    if (!calculator) {
      throw new Error(`Unknown indicator type: ${type}`);
    }
    return calculator;
  }

  /**
   * Build a cache key for indicator results
   */
  private buildCacheKey(
    type: IndicatorType,
    coinId: string,
    prices: PriceSummary[],
    params: Record<string, unknown>
  ): string {
    const dataHash = this.computeDataHash(prices);
    const paramsStr = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join('_');

    return `${INDICATOR_CACHE_CONFIG.KEY_PREFIX}:${type}:${coinId}:${paramsStr}:${dataHash}`;
  }

  /**
   * Compute a hash of the price data for cache invalidation
   * Uses last N prices + total length to detect changes
   */
  private computeDataHash(prices: PriceSummary[]): string {
    if (!prices || prices.length === 0) {
      return 'empty';
    }

    const sampleSize = INDICATOR_CACHE_CONFIG.HASH_SAMPLE_SIZE;
    const effectiveSampleSize = Math.min(sampleSize, prices.length);
    const lastPrices = prices.slice(-effectiveSampleSize).map((p) => p.avg);
    const hashInput = `${prices.length}:${lastPrices.join(',')}`;
    return crypto.createHash('md5').update(hashInput).digest('hex').substring(0, 8);
  }

  /**
   * Get a value from cache
   */
  private async getFromCache<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.cacheManager.get<T>(key);
      return cached ?? null;
    } catch (error) {
      this.logger.warn(`Cache get failed for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Set a value in cache
   */
  private async setInCache<T>(key: string, value: T): Promise<void> {
    try {
      await this.cacheManager.set(key, value, INDICATOR_CACHE_CONFIG.DEFAULT_TTL);
    } catch (error) {
      this.logger.warn(`Cache set failed for key ${key}:`, error);
    }
  }

  /**
   * Pad an array with NaN values at the beginning
   */
  private padArray(values: number[], targetLength: number): number[] {
    const paddingLength = targetLength - values.length;
    if (paddingLength <= 0) {
      return values;
    }
    const padding = new Array<number>(paddingLength).fill(NaN);
    return [...padding, ...values];
  }
}
