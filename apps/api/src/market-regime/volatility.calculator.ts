import { Injectable } from '@nestjs/common';

import { VolatilityConfig, DEFAULT_VOLATILITY_CONFIG } from '@chansey/api-interfaces';

/**
 * Volatility Calculator
 * Calculates realized volatility and percentiles for market regime detection
 */
@Injectable()
export class VolatilityCalculator {
  /**
   * Calculate realized volatility from price data
   * Uses rolling window approach with configurable period
   */
  calculateRealizedVolatility(prices: number[], config: VolatilityConfig = DEFAULT_VOLATILITY_CONFIG): number {
    if (prices.length < config.rollingDays + 1) {
      throw new Error(`Insufficient data: need at least ${config.rollingDays + 1} prices`);
    }

    // Calculate returns
    const returns = this.calculateReturns(prices);

    // Get recent returns for rolling window
    const recentReturns = returns.slice(-config.rollingDays);

    // Calculate volatility based on method
    let volatility: number;

    switch (config.method) {
      case 'standard':
        volatility = this.calculateStandardVolatility(recentReturns);
        break;
      case 'exponential':
        volatility = this.calculateExponentialVolatility(recentReturns);
        break;
      case 'parkinson':
        volatility = this.calculateParkinsonVolatility(prices.slice(-config.rollingDays - 1));
        break;
      default:
        volatility = this.calculateStandardVolatility(recentReturns);
    }

    // Annualize volatility
    const annualizedVolatility = volatility * Math.sqrt(config.annualizationFactor);

    return annualizedVolatility;
  }

  /**
   * Calculate volatility percentile against historical data
   */
  calculatePercentile(
    currentVolatility: number,
    prices: number[],
    config: VolatilityConfig = DEFAULT_VOLATILITY_CONFIG
  ): number {
    if (prices.length < config.lookbackDays) {
      throw new Error(`Insufficient data: need at least ${config.lookbackDays} prices for percentile calculation`);
    }

    // Calculate rolling volatilities over lookback period
    const historicalVolatilities: number[] = [];

    for (let i = config.rollingDays; i < prices.length; i++) {
      const window = prices.slice(i - config.rollingDays, i + 1);
      const returns = this.calculateReturns(window);
      const vol = this.calculateStandardVolatility(returns) * Math.sqrt(config.annualizationFactor);
      historicalVolatilities.push(vol);
    }

    // Calculate percentile rank
    const lowerCount = historicalVolatilities.filter((vol) => vol < currentVolatility).length;
    const percentile = (lowerCount / historicalVolatilities.length) * 100;

    return percentile;
  }

  /**
   * Calculate standard volatility (standard deviation of returns)
   */
  private calculateStandardVolatility(returns: number[]): number {
    if (returns.length === 0) return 0;

    const mean = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    const squaredDiffs = returns.map((ret) => Math.pow(ret - mean, 2));
    const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / returns.length;

    return Math.sqrt(variance);
  }

  /**
   * Calculate exponential weighted volatility
   * Recent returns have higher weight
   */
  private calculateExponentialVolatility(returns: number[], lambda = 0.94): number {
    if (returns.length === 0) return 0;

    const mean = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;

    let weightedVariance = 0;
    let totalWeight = 0;

    for (let i = 0; i < returns.length; i++) {
      const weight = Math.pow(lambda, returns.length - 1 - i);
      weightedVariance += weight * Math.pow(returns[i] - mean, 2);
      totalWeight += weight;
    }

    const variance = weightedVariance / totalWeight;
    return Math.sqrt(variance);
  }

  /**
   * Calculate Parkinson volatility (uses high-low range)
   * More efficient estimator than close-to-close
   */
  private calculateParkinsonVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;

    // For simplicity, treat consecutive prices as high/low
    // In production, use actual OHLC data
    let sumSquaredLogs = 0;

    for (let i = 1; i < prices.length; i++) {
      const high = Math.max(prices[i - 1], prices[i]);
      const low = Math.min(prices[i - 1], prices[i]);

      if (low > 0) {
        const logRatio = Math.log(high / low);
        sumSquaredLogs += Math.pow(logRatio, 2);
      }
    }

    const variance = sumSquaredLogs / (4 * Math.log(2) * (prices.length - 1));
    return Math.sqrt(variance);
  }

  /**
   * Calculate returns from price series
   */
  private calculateReturns(prices: number[]): number[] {
    const returns: number[] = [];

    for (let i = 1; i < prices.length; i++) {
      if (prices[i - 1] !== 0) {
        const ret = (prices[i] - prices[i - 1]) / prices[i - 1];
        returns.push(ret);
      }
    }

    return returns;
  }

  /**
   * Calculate implied volatility (future-looking)
   * Requires options data - placeholder for now
   */
  calculateImpliedVolatility(): number {
    // TODO: Implement when options data is available
    throw new Error('Implied volatility calculation not yet implemented');
  }

  /**
   * Calculate GARCH(1,1) volatility forecast
   * More sophisticated volatility model
   */
  calculateGARCHVolatility(returns: number[]): number {
    // Simplified GARCH(1,1) implementation
    // In production, use dedicated time series library

    if (returns.length < 10) return this.calculateStandardVolatility(returns);

    const omega = 0.000001; // Long-term variance
    const alpha = 0.1; // Weight on recent squared return
    const beta = 0.85; // Weight on previous variance

    let variance = this.calculateStandardVolatility(returns) ** 2;

    for (const ret of returns) {
      variance = omega + alpha * ret ** 2 + beta * variance;
    }

    return Math.sqrt(variance);
  }
}
