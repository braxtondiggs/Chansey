import { type ParameterConstraint } from '../../optimization/interfaces/parameter-space.interface';
import { type IndicatorRequirement } from '../indicators';
import { type ConfluenceConfig } from '../interfaces';

/**
 * Build a fully-defaulted ConfluenceConfig from a raw config record.
 */
export function getConfluenceConfigWithDefaults(config: Record<string, unknown>): ConfluenceConfig {
  const minConfluence = (config.minConfluence as number) ?? 2;
  return {
    minConfluence,
    minSellConfluence: (config.minSellConfluence as number) ?? minConfluence,
    minConfidence: (config.minConfidence as number) ?? 0.5,
    enableShortSignals: (config.enableShortSignals as boolean) ?? false,

    ema: {
      enabled: config.emaEnabled !== false,
      fastPeriod: (config.emaFastPeriod as number) ?? 12,
      slowPeriod: (config.emaSlowPeriod as number) ?? 26
    },

    rsi: {
      enabled: config.rsiEnabled !== false,
      period: (config.rsiPeriod as number) ?? 14,
      buyThreshold: (config.rsiBuyThreshold as number) ?? 55,
      sellThreshold: (config.rsiSellThreshold as number) ?? 45
    },

    macd: {
      enabled: config.macdEnabled !== false,
      fastPeriod: (config.macdFastPeriod as number) ?? 12,
      slowPeriod: (config.macdSlowPeriod as number) ?? 26,
      signalPeriod: (config.macdSignalPeriod as number) ?? 9
    },

    atr: {
      enabled: config.atrEnabled !== false,
      period: (config.atrPeriod as number) ?? 14,
      volatilityThresholdMultiplier: (config.atrVolatilityMultiplier as number) ?? 2.0
    },

    bollingerBands: {
      enabled: config.bbEnabled !== false,
      period: (config.bbPeriod as number) ?? 20,
      stdDev: (config.bbStdDev as number) ?? 2,
      buyThreshold: (config.bbBuyThreshold as number) ?? 0.55,
      sellThreshold: (config.bbSellThreshold as number) ?? 0.45
    }
  };
}

/**
 * Get algorithm-specific configuration schema for the Confluence strategy.
 * @param baseSchema The result of `super.getConfigSchema()` from the base strategy
 */
export function getConfluenceConfigSchema(baseSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    ...baseSchema,

    // Core confluence settings
    minConfluence: {
      type: 'number',
      default: 2,
      min: 2,
      max: 4,
      description: 'Minimum number of directional indicators that must agree for BUY (2-4). ATR is a filter only.'
    },
    enableShortSignals: {
      type: 'boolean',
      default: false,
      description:
        'Enable SHORT_ENTRY/SHORT_EXIT signals for futures markets. When true and marketType is futures, bearish confluence emits SHORT_ENTRY and bullish confluence emits SHORT_EXIT.'
    },
    minSellConfluence: {
      type: 'number',
      default: 2,
      min: 2,
      max: 4,
      description:
        'Minimum number of directional indicators that must agree for SELL (2-4). Defaults to same as minConfluence for symmetric thresholds.'
    },
    minConfidence: {
      type: 'number',
      default: 0.5,
      min: 0,
      max: 1,
      description: 'Minimum confidence required to generate signal'
    },

    // EMA (Trend) settings
    emaEnabled: { type: 'boolean', default: true, description: 'Enable EMA trend indicator' },
    emaFastPeriod: { type: 'number', default: 12, min: 5, max: 20, description: 'Fast EMA period' },
    emaSlowPeriod: { type: 'number', default: 26, min: 15, max: 50, description: 'Slow EMA period' },

    // RSI (Momentum) settings
    rsiEnabled: { type: 'boolean', default: true, description: 'Enable RSI momentum indicator' },
    rsiPeriod: { type: 'number', default: 14, min: 5, max: 30, description: 'RSI calculation period' },
    rsiBuyThreshold: {
      type: 'number',
      default: 55,
      min: 40,
      max: 70,
      description: 'RSI threshold for bullish (RSI > threshold confirms upward momentum)'
    },
    rsiSellThreshold: {
      type: 'number',
      default: 45,
      min: 30,
      max: 60,
      description: 'RSI threshold for bearish (RSI < threshold confirms weak momentum)'
    },

    // MACD (Oscillator) settings
    macdEnabled: { type: 'boolean', default: true, description: 'Enable MACD oscillator indicator' },
    macdFastPeriod: { type: 'number', default: 12, min: 5, max: 20, description: 'MACD fast EMA period' },
    macdSlowPeriod: { type: 'number', default: 26, min: 15, max: 50, description: 'MACD slow EMA period' },
    macdSignalPeriod: { type: 'number', default: 9, min: 5, max: 15, description: 'MACD signal line period' },

    // ATR (Volatility) settings
    atrEnabled: { type: 'boolean', default: true, description: 'Enable ATR volatility filter' },
    atrPeriod: { type: 'number', default: 14, min: 5, max: 30, description: 'ATR calculation period' },
    atrVolatilityMultiplier: {
      type: 'number',
      default: 2.0,
      min: 1.0,
      max: 3.0,
      description: 'ATR threshold multiplier (filter when ATR > avg * multiplier)'
    },

    // Bollinger Bands (Trend Confirmation) settings
    bbEnabled: { type: 'boolean', default: true, description: 'Enable Bollinger Bands trend confirmation indicator' },
    bbPeriod: { type: 'number', default: 20, min: 10, max: 50, description: 'Bollinger Bands calculation period' },
    bbStdDev: { type: 'number', default: 2, min: 1, max: 3, description: 'Standard deviation multiplier' },
    bbBuyThreshold: {
      type: 'number',
      default: 0.55,
      min: 0.3,
      max: 1,
      description: '%B threshold for bullish (> value = price pushing upper band, confirms uptrend)'
    },
    bbSellThreshold: {
      type: 'number',
      default: 0.45,
      min: 0,
      max: 0.7,
      description: '%B threshold for bearish (< value = price pushing lower band, confirms downtrend)'
    }
  };
}

/**
 * Calculate the minimum number of data points required for all enabled indicators.
 */
export function calculateMinDataPoints(config: ConfluenceConfig): number {
  const requirements: number[] = [];
  if (config.ema.enabled) requirements.push(config.ema.slowPeriod + 1);
  if (config.rsi.enabled) requirements.push(config.rsi.period + 1);
  if (config.macd.enabled) requirements.push(config.macd.slowPeriod + config.macd.signalPeriod - 1);
  if (config.atr.enabled) requirements.push(config.atr.period + 1);
  if (config.bollingerBands.enabled) requirements.push(config.bollingerBands.period + 1);
  return requirements.length > 0 ? Math.max(...requirements) : 1;
}

/**
 * Declare indicator requirements for precomputation during optimization.
 */
export function getConfluenceIndicatorRequirements(config: Record<string, unknown>): IndicatorRequirement[] {
  const reqs: IndicatorRequirement[] = [];
  if (config.emaEnabled !== false) {
    reqs.push({ type: 'EMA', paramKeys: ['emaFastPeriod'], defaultParams: { emaFastPeriod: 12 } });
    reqs.push({ type: 'EMA', paramKeys: ['emaSlowPeriod'], defaultParams: { emaSlowPeriod: 26 } });
  }
  if (config.rsiEnabled !== false) {
    reqs.push({ type: 'RSI', paramKeys: ['rsiPeriod'], defaultParams: { rsiPeriod: 14 } });
  }
  if (config.macdEnabled !== false) {
    reqs.push({
      type: 'MACD',
      paramKeys: ['macdFastPeriod', 'macdSlowPeriod', 'macdSignalPeriod'],
      defaultParams: { macdFastPeriod: 12, macdSlowPeriod: 26, macdSignalPeriod: 9 }
    });
  }
  if (config.atrEnabled !== false) {
    reqs.push({ type: 'ATR', paramKeys: ['atrPeriod'], defaultParams: { atrPeriod: 14 } });
  }
  if (config.bbEnabled !== false) {
    reqs.push({
      type: 'BOLLINGER_BANDS',
      paramKeys: ['bbPeriod', 'bbStdDev'],
      defaultParams: { bbPeriod: 20, bbStdDev: 2 }
    });
  }
  return reqs;
}

/**
 * Get parameter constraints for the Confluence strategy optimization.
 */
export function getConfluenceParameterConstraints(): ParameterConstraint[] {
  return [
    {
      type: 'less_than',
      param1: 'emaFastPeriod',
      param2: 'emaSlowPeriod',
      message: 'emaFastPeriod must be less than emaSlowPeriod'
    },
    {
      type: 'less_than',
      param1: 'macdFastPeriod',
      param2: 'macdSlowPeriod',
      message: 'macdFastPeriod must be less than macdSlowPeriod'
    },
    {
      type: 'less_than',
      param1: 'rsiSellThreshold',
      param2: 'rsiBuyThreshold',
      message: 'rsiSellThreshold must be less than rsiBuyThreshold'
    },
    {
      type: 'less_than',
      param1: 'bbSellThreshold',
      param2: 'bbBuyThreshold',
      message: 'bbSellThreshold must be less than bbBuyThreshold'
    },
    {
      // Reject combinations whose minConfluence requirement exceeds the
      // number of enabled directional indicators — these would never
      // produce a buy signal and waste optimizer iterations on guaranteed
      // zero-trade results. ATR is volatility-only and intentionally
      // excluded from the count.
      type: 'custom',
      param1: 'minConfluence',
      customValidator: (params) => {
        const enabledDirectional = [
          params.emaEnabled !== false,
          params.rsiEnabled !== false,
          params.macdEnabled !== false,
          params.bbEnabled !== false
        ].filter(Boolean).length;
        const minBuy = typeof params.minConfluence === 'number' ? params.minConfluence : 2;
        const minSell = typeof params.minSellConfluence === 'number' ? params.minSellConfluence : minBuy;
        return minBuy <= enabledDirectional && minSell <= enabledDirectional;
      },
      message:
        'minConfluence/minSellConfluence must not exceed the number of enabled directional indicators (EMA/RSI/MACD/BB; ATR is filter-only)'
    }
  ];
}
