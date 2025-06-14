import { Injectable, Logger } from '@nestjs/common';

import * as dayjs from 'dayjs';

import { Backtest, BacktestTrade, BacktestPerformanceSnapshot, TradeType } from './backtest.entity';

import { Coin } from '../../coin/coin.entity';
import { Price } from '../../price/price.entity';
import { PriceService } from '../../price/price.service';

export interface MarketData {
  timestamp: Date;
  prices: Map<string, number>; // coinId -> price
}

export interface Position {
  coinId: string;
  quantity: number;
  averagePrice: number;
  totalValue: number;
}

export interface Portfolio {
  cashBalance: number;
  positions: Map<string, Position>;
  totalValue: number;
}

export interface TradingSignal {
  action: 'BUY' | 'SELL' | 'HOLD';
  coinId: string;
  quantity?: number;
  percentage?: number; // percentage of portfolio to allocate
  reason: string;
  confidence?: number; // 0-1 scale
  metadata?: Record<string, any>;
}

@Injectable()
export class BacktestEngine {
  private readonly logger = new Logger(BacktestEngine.name);

  constructor(private readonly priceService: PriceService) {}

  /**
   * Execute a backtest with historical data
   */
  async executeHistoricalBacktest(
    backtest: Backtest,
    coins: Coin[],
    strategyFunction: (marketData: MarketData, portfolio: Portfolio, context: any) => Promise<TradingSignal[]>
  ): Promise<{
    trades: Partial<BacktestTrade>[];
    snapshots: Partial<BacktestPerformanceSnapshot>[];
    finalMetrics: any;
  }> {
    this.logger.log(`Starting historical backtest: ${backtest.name}`);

    // Initialize portfolio
    let portfolio: Portfolio = {
      cashBalance: backtest.initialCapital,
      positions: new Map(),
      totalValue: backtest.initialCapital
    };

    // Arrays to collect results
    const trades: Partial<BacktestTrade>[] = [];
    const snapshots: Partial<BacktestPerformanceSnapshot>[] = [];

    // Get historical price data for all coins
    const coinIds = coins.map((coin) => coin.id);
    const historicalPrices = await this.getHistoricalPrices(coinIds, backtest.startDate, backtest.endDate);

    if (historicalPrices.length === 0) {
      throw new Error('No historical price data available for the specified date range');
    }

    // Group prices by timestamp for easier processing
    const pricesByTimestamp = this.groupPricesByTimestamp(historicalPrices);
    const timestamps = Object.keys(pricesByTimestamp).sort();

    this.logger.log(`Processing ${timestamps.length} time periods`);

    let peakValue = backtest.initialCapital;
    let maxDrawdown = 0;
    const context = { trades: [], previousSignals: new Map() };

    // Process each time period
    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = new Date(timestamps[i]);
      const currentPrices = pricesByTimestamp[timestamps[i]];

      // Create market data for this timestamp
      const marketData: MarketData = {
        timestamp,
        prices: new Map(currentPrices.map((price) => [price.coinId, price.price]))
      };

      // Update portfolio values with current prices
      portfolio = this.updatePortfolioValues(portfolio, marketData.prices);

      // Execute strategy to get trading signals
      try {
        const signals = await strategyFunction(marketData, portfolio, context);

        // Execute trades based on signals
        for (const signal of signals) {
          const trade = await this.executeTrade(signal, portfolio, marketData, backtest.tradingFee);
          if (trade) {
            trades.push({
              ...trade,
              executedAt: timestamp,
              backtest
            });
          }
        }
      } catch (error) {
        this.logger.warn(`Strategy execution failed at ${timestamp}: ${error.message}`);
      }

      // Update peak value and calculate drawdown
      if (portfolio.totalValue > peakValue) {
        peakValue = portfolio.totalValue;
      }
      const currentDrawdown = (peakValue - portfolio.totalValue) / peakValue;
      if (currentDrawdown > maxDrawdown) {
        maxDrawdown = currentDrawdown;
      }

      // Take snapshot every day or at significant points
      if (i % 24 === 0 || i === timestamps.length - 1) {
        // Assuming hourly data, take snapshot daily
        snapshots.push({
          timestamp,
          portfolioValue: portfolio.totalValue,
          cashBalance: portfolio.cashBalance,
          holdings: this.portfolioToHoldings(portfolio, marketData.prices),
          cumulativeReturn: (portfolio.totalValue - backtest.initialCapital) / backtest.initialCapital,
          drawdown: currentDrawdown,
          backtest
        });
      }
    }

    // Calculate final metrics
    const finalMetrics = this.calculateFinalMetrics(backtest, portfolio, trades, snapshots, maxDrawdown);

    this.logger.log(`Backtest completed: ${trades.length} trades, final value: $${portfolio.totalValue.toFixed(2)}`);

    return { trades, snapshots, finalMetrics };
  }

  /**
   * Get historical prices for coins within date range
   */
  private async getHistoricalPrices(coinIds: string[], startDate: Date, endDate: Date): Promise<Price[]> {
    // This would ideally use a more efficient query that filters by date range
    // For now, we'll use the existing price service methods
    const allPrices = await this.priceService.findAll(coinIds);

    return allPrices.filter((price) => {
      const priceDate = new Date(price.geckoLastUpdatedAt);
      return priceDate >= startDate && priceDate <= endDate;
    });
  }

  /**
   * Group prices by timestamp for easier processing
   */
  private groupPricesByTimestamp(prices: Price[]): Record<string, Price[]> {
    return prices.reduce(
      (grouped, price) => {
        const timestamp = price.geckoLastUpdatedAt.toISOString();
        if (!grouped[timestamp]) {
          grouped[timestamp] = [];
        }
        grouped[timestamp].push(price);
        return grouped;
      },
      {} as Record<string, Price[]>
    );
  }

  /**
   * Update portfolio values based on current market prices
   */
  private updatePortfolioValues(portfolio: Portfolio, currentPrices: Map<string, number>): Portfolio {
    let totalValue = portfolio.cashBalance;

    // Update position values
    for (const [coinId, position] of portfolio.positions) {
      const currentPrice = currentPrices.get(coinId);
      if (currentPrice) {
        position.totalValue = position.quantity * currentPrice;
        totalValue += position.totalValue;
      }
    }

    return {
      ...portfolio,
      totalValue
    };
  }

  /**
   * Execute a trade based on a signal
   */
  private async executeTrade(
    signal: TradingSignal,
    portfolio: Portfolio,
    marketData: MarketData,
    tradingFee: number
  ): Promise<Partial<BacktestTrade> | null> {
    const price = marketData.prices.get(signal.coinId);
    if (!price) {
      this.logger.warn(`No price data available for coin ${signal.coinId}`);
      return null;
    }

    if (signal.action === 'HOLD') {
      return null;
    }

    let quantity = 0;
    let totalValue = 0;

    if (signal.action === 'BUY') {
      // Calculate quantity based on signal
      if (signal.quantity) {
        quantity = signal.quantity;
      } else if (signal.percentage) {
        const investmentAmount = portfolio.totalValue * signal.percentage;
        quantity = investmentAmount / price;
      } else {
        // Default to 10% of portfolio
        const investmentAmount = portfolio.totalValue * 0.1;
        quantity = investmentAmount / price;
      }

      totalValue = quantity * price;
      const fee = totalValue * tradingFee;
      const totalCost = totalValue + fee;

      // Check if we have enough cash
      if (totalCost > portfolio.cashBalance) {
        this.logger.warn(
          `Insufficient cash for trade: need $${totalCost.toFixed(2)}, have $${portfolio.cashBalance.toFixed(2)}`
        );
        return null;
      }

      // Execute buy
      portfolio.cashBalance -= totalCost;

      // Update or create position
      const existingPosition = portfolio.positions.get(signal.coinId);
      if (existingPosition) {
        const newQuantity = existingPosition.quantity + quantity;
        const newTotalCost = existingPosition.averagePrice * existingPosition.quantity + totalValue;
        existingPosition.quantity = newQuantity;
        existingPosition.averagePrice = newTotalCost / newQuantity;
        existingPosition.totalValue = newQuantity * price;
      } else {
        portfolio.positions.set(signal.coinId, {
          coinId: signal.coinId,
          quantity,
          averagePrice: price,
          totalValue
        });
      }

      return {
        type: TradeType.BUY,
        quantity,
        price,
        totalValue,
        fee,
        signal: signal.reason,
        metadata: signal.metadata
      };
    } else if (signal.action === 'SELL') {
      const position = portfolio.positions.get(signal.coinId);
      if (!position || position.quantity <= 0) {
        this.logger.warn(`No position to sell for coin ${signal.coinId}`);
        return null;
      }

      // Calculate quantity to sell
      if (signal.quantity) {
        quantity = Math.min(signal.quantity, position.quantity);
      } else if (signal.percentage) {
        quantity = position.quantity * signal.percentage;
      } else {
        // Default to selling entire position
        quantity = position.quantity;
      }

      totalValue = quantity * price;
      const fee = totalValue * tradingFee;
      const netProceeds = totalValue - fee;

      // Execute sell
      portfolio.cashBalance += netProceeds;

      // Update position
      position.quantity -= quantity;
      if (position.quantity <= 0) {
        portfolio.positions.delete(signal.coinId);
      } else {
        position.totalValue = position.quantity * price;
      }

      return {
        type: TradeType.SELL,
        quantity,
        price,
        totalValue,
        fee,
        signal: signal.reason,
        metadata: signal.metadata
      };
    }

    return null;
  }

  /**
   * Convert portfolio to holdings format for snapshots
   */
  private portfolioToHoldings(portfolio: Portfolio, currentPrices: Map<string, number>): Record<string, any> {
    const holdings: Record<string, any> = {};

    for (const [coinId, position] of portfolio.positions) {
      const currentPrice = currentPrices.get(coinId) || position.averagePrice;
      holdings[coinId] = {
        quantity: position.quantity,
        value: position.quantity * currentPrice,
        price: currentPrice
      };
    }

    return holdings;
  }

  /**
   * Calculate final performance metrics
   */
  private calculateFinalMetrics(
    backtest: Backtest,
    portfolio: Portfolio,
    trades: Partial<BacktestTrade>[],
    snapshots: Partial<BacktestPerformanceSnapshot>[],
    maxDrawdown: number
  ): any {
    const totalReturn = (portfolio.totalValue - backtest.initialCapital) / backtest.initialCapital;

    // Calculate time period for annualized return
    const startDate = dayjs(backtest.startDate);
    const endDate = dayjs(backtest.endDate);
    const daysDuration = endDate.diff(startDate, 'days');
    const yearsDuration = daysDuration / 365;

    const annualizedReturn = yearsDuration > 0 ? Math.pow(1 + totalReturn, 1 / yearsDuration) - 1 : totalReturn;

    // Calculate Sharpe ratio (simplified - using total return / volatility)
    const returns = snapshots
      .map((snapshot, index) => {
        if (index === 0) return 0;
        const prevSnapshot = snapshots[index - 1];
        return (snapshot.portfolioValue! - prevSnapshot.portfolioValue!) / prevSnapshot.portfolioValue!;
      })
      .filter((_, index) => index > 0);

    const avgReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length;
    const volatility = Math.sqrt(variance);
    const sharpeRatio = volatility > 0 ? avgReturn / volatility : 0;

    // Calculate win rate
    const winningTrades = trades.filter((trade) => {
      // This is simplified - in reality you'd track profit/loss per trade
      return trade.type === TradeType.SELL; // Assuming sells are profitable
    }).length;

    const winRate = trades.length > 0 ? winningTrades / trades.length : 0;

    return {
      finalValue: portfolio.totalValue,
      totalReturn,
      annualizedReturn,
      sharpeRatio,
      maxDrawdown,
      totalTrades: trades.length,
      winningTrades,
      winRate
    };
  }

  /**
   * Calculate performance metrics for comparison
   */
  calculatePerformanceMetrics(
    initialCapital: number,
    snapshots: BacktestPerformanceSnapshot[]
  ): {
    totalReturn: number;
    annualizedReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    volatility: number;
    calmarRatio: number;
  } {
    if (snapshots.length === 0) {
      return {
        totalReturn: 0,
        annualizedReturn: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        volatility: 0,
        calmarRatio: 0
      };
    }

    const finalValue = snapshots[snapshots.length - 1].portfolioValue;
    const totalReturn = (finalValue - initialCapital) / initialCapital;

    // Calculate daily returns
    const dailyReturns = snapshots
      .map((snapshot, index) => {
        if (index === 0) return 0;
        const prevValue = snapshots[index - 1].portfolioValue;
        return (snapshot.portfolioValue - prevValue) / prevValue;
      })
      .slice(1);

    // Calculate volatility (standard deviation of daily returns)
    const avgDailyReturn = dailyReturns.reduce((sum, ret) => sum + ret, 0) / dailyReturns.length;
    const variance =
      dailyReturns.reduce((sum, ret) => sum + Math.pow(ret - avgDailyReturn, 2), 0) / dailyReturns.length;
    const volatility = Math.sqrt(variance) * Math.sqrt(252); // Annualized volatility

    // Calculate max drawdown
    const maxDrawdown = Math.max(...snapshots.map((s) => s.drawdown));

    // Calculate annualized return
    const startDate = dayjs(snapshots[0].timestamp);
    const endDate = dayjs(snapshots[snapshots.length - 1].timestamp);
    const yearsDuration = endDate.diff(startDate, 'days') / 365;
    const annualizedReturn = yearsDuration > 0 ? Math.pow(1 + totalReturn, 1 / yearsDuration) - 1 : totalReturn;

    // Calculate Sharpe ratio (assuming risk-free rate of 2%)
    const riskFreeRate = 0.02;
    const sharpeRatio = volatility > 0 ? (annualizedReturn - riskFreeRate) / volatility : 0;

    // Calculate Calmar ratio (annualized return / max drawdown)
    const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0;

    return {
      totalReturn,
      annualizedReturn,
      sharpeRatio,
      maxDrawdown,
      volatility,
      calmarRatio
    };
  }
}
