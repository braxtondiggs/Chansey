import { Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { OrderService } from '../../order/order.service';
import { PortfolioService } from '../../portfolio/portfolio.service';
import { PriceSummary } from '../../price/price.entity';
import { PriceService } from '../../price/price.service';
import { BaseAlgorithmStrategy } from '../base/base-algorithm-strategy';
import { AlgorithmContext, AlgorithmResult, ChartDataPoint, SignalType, TradingSignal } from '../interfaces';

/**
 * Exponential Moving Average (EMA) Algorithm Strategy
 * Generates trading signals based on EMA crossovers and price momentum
 */
@Injectable()
export class ExponentialMovingAverageStrategy extends BaseAlgorithmStrategy {
  readonly id = '3916f8b1-23f5-4d17-a839-6cdecb13588f';
  readonly name = 'Exponential Moving Average';
  readonly version = '2.0.0';
  readonly description = 'Trading strategy using exponential moving averages for trend analysis and signal generation';

  constructor(
    schedulerRegistry: SchedulerRegistry,
    private readonly portfolioService: PortfolioService,
    private readonly priceService: PriceService,
    private readonly orderService: OrderService
  ) {
    super(schedulerRegistry);
  }

  /**
   * Execute the EMA algorithm
   */
  async execute(context: AlgorithmContext): Promise<AlgorithmResult> {
    const signals: TradingSignal[] = [];
    const chartData: { [key: string]: ChartDataPoint[] } = {};

    try {
      for (const coin of context.coins) {
        const priceHistory = context.priceData[coin.id];
        
        if (!priceHistory || priceHistory.length < 26) {
          this.logger.warn(`Insufficient price data for ${coin.symbol}`);
          continue;
        }

        // Calculate EMAs
        const ema12 = this.calculateEMA(priceHistory, 12);
        const ema26 = this.calculateEMA(priceHistory, 26);

        // Generate signals based on EMA crossover
        const signal = this.generateSignal(coin.id, coin.symbol, priceHistory, ema12, ema26);
        
        if (signal) {
          signals.push(signal);
        }

        // Prepare chart data
        chartData[coin.id] = this.prepareChartData(priceHistory, ema12, ema26);
      }

      return this.createSuccessResult(signals, chartData, {
        algorithm: this.name,
        version: this.version,
        signalsGenerated: signals.length
      });

    } catch (error) {
      this.logger.error(`EMA algorithm execution failed: ${error.message}`, error.stack);
      return this.createErrorResult(error.message);
    }
  }

  /**
   * Calculate Exponential Moving Average
   */
  private calculateEMA(prices: PriceSummary[], period: number): number[] {
    if (prices.length < period) {
      throw new Error(`Insufficient data: need at least ${period} price points`);
    }

    const emaValues: number[] = [];
    const multiplier = 2 / (period + 1);

    // Calculate initial SMA for the first EMA value
    let sma = 0;
    for (let i = 0; i < period; i++) {
      sma += prices[i].avg;
    }
    sma /= period;

    // Fill initial values with null
    for (let i = 0; i < period - 1; i++) {
      emaValues.push(NaN);
    }
    
    emaValues.push(sma);

    // Calculate EMA for remaining values
    for (let i = period; i < prices.length; i++) {
      const ema = (prices[i].avg - emaValues[i - 1]) * multiplier + emaValues[i - 1];
      emaValues.push(ema);
    }

    return emaValues;
  }

  /**
   * Generate trading signal based on EMA crossover
   */
  private generateSignal(
    coinId: string,
    coinSymbol: string,
    prices: PriceSummary[],
    ema12: number[],
    ema26: number[]
  ): TradingSignal | null {
    const currentIndex = prices.length - 1;
    const previousIndex = currentIndex - 1;

    if (previousIndex < 0 || isNaN(ema12[currentIndex]) || isNaN(ema26[currentIndex])) {
      return null;
    }

    const currentPrice = prices[currentIndex].avg;
    const currentEma12 = ema12[currentIndex];
    const currentEma26 = ema26[currentIndex];
    const previousEma12 = ema12[previousIndex];
    const previousEma26 = ema26[previousIndex];

    // Check for crossover signals
    const isBullishCrossover = previousEma12 <= previousEma26 && currentEma12 > currentEma26;
    const isBearishCrossover = previousEma12 >= previousEma26 && currentEma12 < currentEma26;

    if (isBullishCrossover) {
      // Golden cross - buy signal
      return {
        type: SignalType.BUY,
        coinId,
        strength: this.calculateSignalStrength(currentPrice, currentEma12, currentEma26),
        price: currentPrice,
        confidence: this.calculateConfidence(prices, ema12, ema26, 'bullish'),
        reason: `Bullish EMA crossover: EMA12 (${currentEma12.toFixed(4)}) crossed above EMA26 (${currentEma26.toFixed(4)})`,
        metadata: {
          symbol: coinSymbol,
          ema12: currentEma12,
          ema26: currentEma26,
          crossoverType: 'golden'
        }
      };
    }

    if (isBearishCrossover) {
      // Death cross - sell signal
      return {
        type: SignalType.SELL,
        coinId,
        strength: this.calculateSignalStrength(currentPrice, currentEma12, currentEma26),
        price: currentPrice,
        confidence: this.calculateConfidence(prices, ema12, ema26, 'bearish'),
        reason: `Bearish EMA crossover: EMA12 (${currentEma12.toFixed(4)}) crossed below EMA26 (${currentEma26.toFixed(4)})`,
        metadata: {
          symbol: coinSymbol,
          ema12: currentEma12,
          ema26: currentEma26,
          crossoverType: 'death'
        }
      };
    }

    // No clear signal
    return null;
  }

  /**
   * Calculate signal strength based on price position relative to EMAs
   */
  private calculateSignalStrength(price: number, ema12: number, ema26: number): number {
    const emaSpread = Math.abs(ema12 - ema26) / Math.max(ema12, ema26);
    const pricePosition = (price - Math.min(ema12, ema26)) / Math.abs(ema12 - ema26);
    
    // Strength is based on EMA spread and price position
    return Math.min(1, Math.max(0, emaSpread * 2 + pricePosition * 0.5));
  }

  /**
   * Calculate confidence level for the signal
   */
  private calculateConfidence(
    prices: PriceSummary[],
    ema12: number[],
    ema26: number[],
    direction: 'bullish' | 'bearish'
  ): number {
    const recentPeriod = 5;
    const startIndex = Math.max(0, prices.length - recentPeriod);
    
    let trendConfirmations = 0;
    for (let i = startIndex; i < prices.length - 1; i++) {
      if (direction === 'bullish' && ema12[i] > ema26[i]) {
        trendConfirmations++;
      } else if (direction === 'bearish' && ema12[i] < ema26[i]) {
        trendConfirmations++;
      }
    }

    return trendConfirmations / recentPeriod;
  }

  /**
   * Prepare chart data for visualization
   */
  private prepareChartData(prices: PriceSummary[], ema12: number[], ema26: number[]): ChartDataPoint[] {
    return prices.map((price, index) => ({
      timestamp: price.date,
      value: price.avg,
      metadata: {
        ema12: ema12[index],
        ema26: ema26[index],
        high: price.high,
        low: price.low
      }
    }));
  }

  /**
   * Get algorithm-specific configuration schema
   */
  getConfigSchema(): Record<string, unknown> {
    return {
      ...super.getConfigSchema(),
      fastPeriod: { type: 'number', default: 12, min: 5, max: 50 },
      slowPeriod: { type: 'number', default: 26, min: 10, max: 100 },
      minConfidence: { type: 'number', default: 0.6, min: 0, max: 1 },
      enableStopLoss: { type: 'boolean', default: true },
      stopLossPercentage: { type: 'number', default: 0.05, min: 0.01, max: 0.2 }
    };
  }

  /**
   * Enhanced validation for EMA algorithm
   */
  canExecute(context: AlgorithmContext): boolean {
    if (!super.canExecute(context)) {
      return false;
    }

    // Check if we have sufficient price data for EMA calculation
    for (const coin of context.coins) {
      const priceHistory = context.priceData[coin.id];
      if (!priceHistory || priceHistory.length < 26) {
        return false;
      }
    }

    return true;
  }

  /**
   * Scheduled execution with context building
   */
  protected async scheduledExecution(): Promise<void> {
    try {
      if (!this.algorithm) {
        this.logger.warn('Algorithm not initialized for scheduled execution');
        return;
      }

      // You would typically inject the context builder here
      // For now, this is a placeholder for the scheduled execution logic
      this.logger.log('EMA scheduled execution completed');
      
    } catch (error) {
      this.logger.error(`Scheduled execution failed: ${error.message}`, error.stack);
    }
  }
}
