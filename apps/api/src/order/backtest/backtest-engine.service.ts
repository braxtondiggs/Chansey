import { Injectable, Logger } from '@nestjs/common';

import * as dayjs from 'dayjs';

import { BacktestStreamService } from './backtest-stream.service';
import {
  Backtest,
  BacktestPerformanceSnapshot,
  BacktestSignal,
  BacktestTrade,
  SignalDirection,
  SignalType,
  SimulatedOrderFill,
  SimulatedOrderStatus,
  SimulatedOrderType,
  TradeType
} from './backtest.entity';
import { MarketDataSet } from './market-data-set.entity';

import {
  AlgorithmResult,
  SignalType as AlgoSignalType,
  TradingSignal as StrategySignal
} from '../../algorithm/interfaces';
import { AlgorithmRegistry } from '../../algorithm/registry/algorithm-registry.service';
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
  percentage?: number;
  reason: string;
  confidence?: number;
  metadata?: Record<string, any>;
}

interface ExecuteOptions {
  dataset: MarketDataSet;
  deterministicSeed: string;
  telemetryEnabled?: boolean;
}

const createSeededGenerator = (seed: string) => {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
};

const mapStrategySignal = (signal: StrategySignal): TradingSignal => {
  const action: TradingSignal['action'] =
    signal.type === AlgoSignalType.SELL ? 'SELL' : signal.type === AlgoSignalType.BUY ? 'BUY' : 'HOLD';

  return {
    action,
    coinId: signal.coinId,
    quantity: signal.quantity,
    percentage: signal.strength,
    reason: signal.reason,
    confidence: signal.confidence,
    metadata: signal.metadata
  };
};

/**
 * Configuration for running an optimization backtest
 */
export interface OptimizationBacktestConfig {
  algorithmId: string;
  parameters: Record<string, unknown>;
  startDate: Date;
  endDate: Date;
  initialCapital?: number;
  tradingFee?: number;
  coinIds?: string[];
}

/**
 * Result metrics from an optimization backtest
 */
export interface OptimizationBacktestResult {
  sharpeRatio: number;
  totalReturn: number;
  maxDrawdown: number;
  winRate: number;
  volatility: number;
  profitFactor: number;
  tradeCount: number;
  annualizedReturn?: number;
  finalValue?: number;
}

@Injectable()
export class BacktestEngine {
  private readonly logger = new Logger(BacktestEngine.name);

  constructor(
    private readonly priceService: PriceService,
    private readonly backtestStream: BacktestStreamService,
    private readonly algorithmRegistry: AlgorithmRegistry
  ) {}

  async executeHistoricalBacktest(
    backtest: Backtest,
    coins: Coin[],
    options: ExecuteOptions
  ): Promise<{
    trades: Partial<BacktestTrade>[];
    signals: Partial<BacktestSignal>[];
    simulatedFills: Partial<SimulatedOrderFill>[];
    snapshots: Partial<BacktestPerformanceSnapshot>[];
    finalMetrics: Record<string, unknown>;
  }> {
    if (!backtest.algorithm) {
      throw new Error('Backtest algorithm relation not loaded');
    }

    this.logger.log(
      `Starting historical backtest: ${backtest.name} (dataset=${options.dataset.id}, seed=${options.deterministicSeed})`
    );

    const random = createSeededGenerator(options.deterministicSeed);

    let portfolio: Portfolio = {
      cashBalance: backtest.initialCapital,
      positions: new Map(),
      totalValue: backtest.initialCapital
    };

    const trades: Partial<BacktestTrade>[] = [];
    const signals: Partial<BacktestSignal>[] = [];
    const simulatedFills: Partial<SimulatedOrderFill>[] = [];
    const snapshots: Partial<BacktestPerformanceSnapshot>[] = [];

    const coinIds = coins.map((coin) => coin.id);
    const historicalPrices = await this.getHistoricalPrices(
      coinIds,
      options.dataset.startAt ?? backtest.startDate,
      options.dataset.endAt ?? backtest.endDate
    );

    if (historicalPrices.length === 0) {
      throw new Error('No historical price data available for the specified date range');
    }

    const pricesByTimestamp = this.groupPricesByTimestamp(historicalPrices);
    const timestamps = Object.keys(pricesByTimestamp).sort();

    const priceHistoryByCoin = new Map<string, Price[]>();
    const priceSummariesByCoin = new Map<
      string,
      { avg: number; coin: string; date: Date; high: number; low: number }[]
    >();
    const indexByCoin = new Map<string, number>();

    for (const coinId of coinIds) {
      const history = historicalPrices
        .filter((price) => price.coinId === coinId)
        .sort((a, b) => a.geckoLastUpdatedAt.getTime() - b.geckoLastUpdatedAt.getTime());
      priceHistoryByCoin.set(coinId, history);
      priceSummariesByCoin.set(
        coinId,
        history.map((price) => ({
          avg: price.price,
          coin: coinId,
          date: price.geckoLastUpdatedAt,
          high: price.price,
          low: price.price
        }))
      );
      indexByCoin.set(coinId, -1);
    }

    this.logger.log(`Processing ${timestamps.length} time periods`);

    let peakValue = backtest.initialCapital;
    let maxDrawdown = 0;

    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = new Date(timestamps[i]);
      const currentPrices = pricesByTimestamp[timestamps[i]];

      const marketData: MarketData = {
        timestamp,
        prices: new Map(currentPrices.map((price) => [price.coinId, price.price]))
      };

      portfolio = this.updatePortfolioValues(portfolio, marketData.prices);

      const priceData: Record<string, { avg: number; coin: string; date: Date; high: number; low: number }[]> = {};
      for (const coin of coins) {
        const history = priceHistoryByCoin.get(coin.id) ?? [];
        let pointer = indexByCoin.get(coin.id) ?? -1;
        while (pointer + 1 < history.length && history[pointer + 1].geckoLastUpdatedAt <= timestamp) {
          pointer += 1;
        }
        indexByCoin.set(coin.id, pointer);
        if (pointer >= 0) {
          const summaries = priceSummariesByCoin.get(coin.id) ?? [];
          priceData[coin.id] = summaries.slice(0, pointer + 1);
        }
      }

      const context = {
        coins,
        priceData,
        timestamp,
        config: backtest.configSnapshot?.parameters ?? {},
        positions: Object.fromEntries(
          [...portfolio.positions.entries()].map(([id, position]) => [id, position.quantity])
        ),
        availableBalance: portfolio.cashBalance,
        metadata: {
          datasetId: options.dataset.id,
          deterministicSeed: options.deterministicSeed,
          backtestId: backtest.id
        }
      };

      let strategySignals: TradingSignal[] = [];
      try {
        const result: AlgorithmResult = await this.algorithmRegistry.executeAlgorithm(backtest.algorithm.id, context);
        if (result.success && result.signals?.length) {
          strategySignals = result.signals.map(mapStrategySignal).filter((signal) => signal.action !== 'HOLD');
        }
      } catch (error) {
        this.logger.warn(`Algorithm execution failed at ${timestamp.toISOString()}: ${error.message}`);
      }

      for (const strategySignal of strategySignals) {
        const signalRecord: Partial<BacktestSignal> = {
          timestamp,
          signalType:
            strategySignal.action === 'BUY'
              ? SignalType.ENTRY
              : strategySignal.action === 'SELL'
                ? SignalType.EXIT
                : SignalType.ADJUSTMENT,
          instrument: strategySignal.coinId,
          direction:
            strategySignal.action === 'HOLD'
              ? SignalDirection.FLAT
              : strategySignal.action === 'BUY'
                ? SignalDirection.LONG
                : SignalDirection.SHORT,
          quantity: strategySignal.quantity ?? strategySignal.percentage ?? 0,
          price: marketData.prices.get(strategySignal.coinId),
          reason: strategySignal.reason,
          confidence: strategySignal.confidence,
          payload: strategySignal.metadata,
          backtest
        };
        signals.push(signalRecord);

        const trade = await this.executeTrade(strategySignal, portfolio, marketData, backtest.tradingFee, random);
        if (trade) {
          trades.push({ ...trade, executedAt: timestamp, backtest });
          simulatedFills.push({
            orderType: SimulatedOrderType.MARKET,
            status: SimulatedOrderStatus.FILLED,
            filledQuantity: trade.quantity,
            averagePrice: trade.price,
            fees: trade.fee,
            slippageBps: 0,
            executionTimestamp: timestamp,
            instrument: strategySignal.coinId,
            metadata: trade.metadata,
            backtest
          });
        }
      }

      if (portfolio.totalValue > peakValue) {
        peakValue = portfolio.totalValue;
      }
      const currentDrawdown = peakValue === 0 ? 0 : (peakValue - portfolio.totalValue) / peakValue;
      if (currentDrawdown > maxDrawdown) {
        maxDrawdown = currentDrawdown;
      }

      if (i % 24 === 0 || i === timestamps.length - 1) {
        snapshots.push({
          timestamp,
          portfolioValue: portfolio.totalValue,
          cashBalance: portfolio.cashBalance,
          holdings: this.portfolioToHoldings(portfolio, marketData.prices),
          cumulativeReturn: (portfolio.totalValue - backtest.initialCapital) / backtest.initialCapital,
          drawdown: currentDrawdown,
          backtest
        });

        if (options.telemetryEnabled) {
          await this.backtestStream.publishMetric(backtest.id, 'portfolio_value', portfolio.totalValue, 'USD', {
            timestamp: timestamp.toISOString()
          });
        }
      }
    }

    const finalMetrics = this.calculateFinalMetrics(backtest, portfolio, trades, snapshots, maxDrawdown);

    if (options.telemetryEnabled) {
      await this.backtestStream.publishMetric(
        backtest.id,
        'final_value',
        finalMetrics.finalValue ?? portfolio.totalValue,
        'USD'
      );
      await this.backtestStream.publishMetric(backtest.id, 'total_return', finalMetrics.totalReturn ?? 0, 'pct');
      await this.backtestStream.publishStatus(backtest.id, 'completed');
    }

    this.logger.log(`Backtest completed: ${trades.length} trades, final value: $${portfolio.totalValue.toFixed(2)}`);

    return { trades, signals, simulatedFills, snapshots, finalMetrics };
  }

  private async getHistoricalPrices(coinIds: string[], startDate: Date, endDate: Date): Promise<Price[]> {
    const allPrices = await this.priceService.findAll(coinIds);

    return allPrices.filter((price) => {
      const priceDate = new Date(price.geckoLastUpdatedAt);
      return priceDate >= startDate && priceDate <= endDate;
    });
  }

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

  private updatePortfolioValues(portfolio: Portfolio, currentPrices: Map<string, number>): Portfolio {
    let totalValue = portfolio.cashBalance;

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

  private async executeTrade(
    signal: TradingSignal,
    portfolio: Portfolio,
    marketData: MarketData,
    tradingFee: number,
    random: () => number
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
      if (signal.quantity) {
        quantity = signal.quantity;
      } else if (signal.percentage) {
        const investmentAmount = portfolio.totalValue * signal.percentage;
        quantity = investmentAmount / price;
      } else {
        const investmentAmount = portfolio.totalValue * Math.min(0.2, Math.max(0.05, random()));
        quantity = investmentAmount / price;
      }

      totalValue = quantity * price;

      if (portfolio.cashBalance < totalValue) {
        this.logger.warn('Insufficient cash balance for BUY trade');
        return null;
      }

      portfolio.cashBalance -= totalValue;

      const existingPosition = portfolio.positions.get(signal.coinId) ?? {
        coinId: signal.coinId,
        quantity: 0,
        averagePrice: 0,
        totalValue: 0
      };

      const newQuantity = existingPosition.quantity + quantity;
      existingPosition.averagePrice = existingPosition.quantity
        ? (existingPosition.averagePrice * existingPosition.quantity + price * quantity) / newQuantity
        : price;
      existingPosition.quantity = newQuantity;
      existingPosition.totalValue = existingPosition.quantity * price;

      portfolio.positions.set(signal.coinId, existingPosition);
    } else if (signal.action === 'SELL') {
      const existingPosition = portfolio.positions.get(signal.coinId);
      if (!existingPosition || existingPosition.quantity === 0) {
        return null;
      }

      quantity = signal.quantity ?? existingPosition.quantity * Math.min(1, Math.max(0.25, random()));
      quantity = Math.min(quantity, existingPosition.quantity);
      totalValue = quantity * price;

      existingPosition.quantity -= quantity;
      existingPosition.totalValue = existingPosition.quantity * price;
      portfolio.cashBalance += totalValue;

      if (existingPosition.quantity === 0) {
        portfolio.positions.delete(signal.coinId);
      } else {
        portfolio.positions.set(signal.coinId, existingPosition);
      }
    }

    const fee = totalValue * tradingFee;
    portfolio.cashBalance -= fee;
    portfolio.totalValue = portfolio.cashBalance + this.calculatePositionsValue(portfolio.positions, marketData.prices);

    return {
      type: signal.action === 'BUY' ? TradeType.BUY : TradeType.SELL,
      quantity,
      price,
      totalValue,
      fee,
      metadata: {
        reason: signal.reason,
        confidence: signal.confidence ?? 0
      }
    } as Partial<BacktestTrade>;
  }

  private calculatePositionsValue(positions: Map<string, Position>, currentPrices: Map<string, number>): number {
    let total = 0;
    for (const [coinId, position] of positions) {
      const price = currentPrices.get(coinId) ?? 0;
      total += position.quantity * price;
    }
    return total;
  }

  private portfolioToHoldings(portfolio: Portfolio, prices: Map<string, number>) {
    const holdings: Record<string, { quantity: number; value: number; price: number }> = {};
    for (const [coinId, position] of portfolio.positions) {
      const price = prices.get(coinId) ?? 0;
      holdings[coinId] = {
        quantity: position.quantity,
        value: position.quantity * price,
        price
      };
    }
    return holdings;
  }

  private calculateFinalMetrics(
    backtest: Backtest,
    portfolio: Portfolio,
    trades: Partial<BacktestTrade>[],
    snapshots: Partial<BacktestPerformanceSnapshot>[],
    maxDrawdown: number
  ) {
    const finalValue = portfolio.totalValue;
    const totalReturn = (finalValue - backtest.initialCapital) / backtest.initialCapital;
    const totalTrades = trades.length;
    const winningTrades = trades.filter((trade) => (trade.totalValue ?? 0) > 0).length;

    const durationDays = dayjs(backtest.endDate).diff(dayjs(backtest.startDate), 'day');
    const annualizedReturn = durationDays > 0 ? Math.pow(1 + totalReturn, 365 / durationDays) - 1 : totalReturn;

    const sharpeRatio = this.calculateSharpeRatio(snapshots, backtest.initialCapital);

    return {
      finalValue,
      totalReturn,
      annualizedReturn,
      sharpeRatio,
      maxDrawdown,
      totalTrades,
      winningTrades,
      winRate: totalTrades ? winningTrades / totalTrades : 0,
      performanceHistory: snapshots
    };
  }

  private calculateSharpeRatio(snapshots: Partial<BacktestPerformanceSnapshot>[], initialCapital: number): number {
    if (!snapshots.length) {
      return 0;
    }

    const returns: number[] = [];
    for (let i = 1; i < snapshots.length; i++) {
      const previous = snapshots[i - 1].portfolioValue ?? initialCapital;
      const current = snapshots[i].portfolioValue ?? initialCapital;
      returns.push(previous === 0 ? 0 : (current - previous) / previous);
    }

    if (returns.length === 0) {
      return 0;
    }

    const average = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance = returns.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) {
      return 0;
    }

    const riskFreeRate = 0.02; // 2% annualized risk-free rate (placeholder)
    return (average - riskFreeRate / 365) / stdDev;
  }

  /**
   * Execute a lightweight backtest for parameter optimization
   * This method doesn't persist any data - it runs the simulation and returns metrics only
   */
  async executeOptimizationBacktest(
    config: OptimizationBacktestConfig,
    coins: Coin[]
  ): Promise<OptimizationBacktestResult> {
    const initialCapital = config.initialCapital ?? 10000;
    const tradingFee = config.tradingFee ?? 0.001;
    const deterministicSeed = `optimization-${config.algorithmId}-${Date.now()}`;

    this.logger.debug(
      `Running optimization backtest: algo=${config.algorithmId}, ` +
        `range=${config.startDate.toISOString()} to ${config.endDate.toISOString()}`
    );

    const random = createSeededGenerator(deterministicSeed);

    let portfolio: Portfolio = {
      cashBalance: initialCapital,
      positions: new Map(),
      totalValue: initialCapital
    };

    const trades: Partial<BacktestTrade>[] = [];
    const snapshots: { portfolioValue: number; timestamp: Date }[] = [];

    const coinIds = coins.map((coin) => coin.id);
    const historicalPrices = await this.getHistoricalPrices(coinIds, config.startDate, config.endDate);

    if (historicalPrices.length === 0) {
      // Return neutral metrics if no price data
      return {
        sharpeRatio: 0,
        totalReturn: 0,
        maxDrawdown: 0,
        winRate: 0,
        volatility: 0,
        profitFactor: 1,
        tradeCount: 0
      };
    }

    const pricesByTimestamp = this.groupPricesByTimestamp(historicalPrices);
    const timestamps = Object.keys(pricesByTimestamp).sort();

    // Build price history for algorithm context
    const priceHistoryByCoin = new Map<string, { avg: number; date: Date }[]>();
    const indexByCoin = new Map<string, number>();

    for (const coinId of coinIds) {
      const history = historicalPrices
        .filter((price) => price.coinId === coinId)
        .sort((a, b) => a.geckoLastUpdatedAt.getTime() - b.geckoLastUpdatedAt.getTime())
        .map((price) => ({
          avg: price.price,
          date: price.geckoLastUpdatedAt
        }));
      priceHistoryByCoin.set(coinId, history);
      indexByCoin.set(coinId, -1);
    }

    let peakValue = initialCapital;
    let maxDrawdown = 0;

    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = new Date(timestamps[i]);
      const currentPrices = pricesByTimestamp[timestamps[i]];

      const marketData: MarketData = {
        timestamp,
        prices: new Map(currentPrices.map((price) => [price.coinId, price.price]))
      };

      portfolio = this.updatePortfolioValues(portfolio, marketData.prices);

      // Build price data context for algorithm
      const priceData: Record<string, { avg: number; coin: string; date: Date; high: number; low: number }[]> = {};
      for (const coin of coins) {
        const history = priceHistoryByCoin.get(coin.id) ?? [];
        let pointer = indexByCoin.get(coin.id) ?? -1;
        while (pointer + 1 < history.length && history[pointer + 1].date <= timestamp) {
          pointer += 1;
        }
        indexByCoin.set(coin.id, pointer);
        if (pointer >= 0) {
          priceData[coin.id] = history.slice(0, pointer + 1).map((h) => ({
            ...h,
            coin: coin.id,
            high: h.avg,
            low: h.avg
          }));
        }
      }

      // Build algorithm context with optimization parameters
      const context = {
        coins,
        priceData,
        timestamp,
        config: config.parameters, // Use optimization parameters instead of stored config
        positions: Object.fromEntries(
          [...portfolio.positions.entries()].map(([id, position]) => [id, position.quantity])
        ),
        availableBalance: portfolio.cashBalance,
        metadata: {
          isOptimization: true,
          algorithmId: config.algorithmId
        }
      };

      let strategySignals: TradingSignal[] = [];
      try {
        const result = await this.algorithmRegistry.executeAlgorithm(config.algorithmId, context);
        if (result.success && result.signals?.length) {
          strategySignals = result.signals.map(mapStrategySignal).filter((signal) => signal.action !== 'HOLD');
        }
      } catch (error) {
        // Log but continue - optimization should be resilient to occasional failures
        this.logger.warn(`Algorithm execution failed at ${timestamp.toISOString()}: ${error.message}`);
      }

      for (const strategySignal of strategySignals) {
        const trade = await this.executeTrade(strategySignal, portfolio, marketData, tradingFee, random);
        if (trade) {
          trades.push({ ...trade, executedAt: timestamp });
        }
      }

      // Track peak and drawdown
      if (portfolio.totalValue > peakValue) {
        peakValue = portfolio.totalValue;
      }
      const currentDrawdown = peakValue === 0 ? 0 : (peakValue - portfolio.totalValue) / peakValue;
      if (currentDrawdown > maxDrawdown) {
        maxDrawdown = currentDrawdown;
      }

      // Sample snapshots less frequently for optimization (every 24 periods)
      if (i % 24 === 0 || i === timestamps.length - 1) {
        snapshots.push({
          timestamp,
          portfolioValue: portfolio.totalValue
        });
      }
    }

    // Calculate final metrics
    const finalValue = portfolio.totalValue;
    const totalReturn = (finalValue - initialCapital) / initialCapital;
    const totalTrades = trades.length;
    const winningTrades = trades.filter((trade) => (trade.totalValue ?? 0) > 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    const durationDays = dayjs(config.endDate).diff(dayjs(config.startDate), 'day');
    const annualizedReturn = durationDays > 0 ? Math.pow(1 + totalReturn, 365 / durationDays) - 1 : totalReturn;

    // Calculate volatility from returns
    const returns: number[] = [];
    for (let i = 1; i < snapshots.length; i++) {
      const previous = snapshots[i - 1].portfolioValue;
      const current = snapshots[i].portfolioValue;
      returns.push(previous === 0 ? 0 : (current - previous) / previous);
    }

    const avgReturn = returns.length > 0 ? returns.reduce((sum, r) => sum + r, 0) / returns.length : 0;
    const variance =
      returns.length > 0 ? returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length : 0;
    const volatility = Math.sqrt(variance) * Math.sqrt(252); // Annualized volatility

    // Calculate Sharpe ratio
    const riskFreeRate = 0.02;
    const sharpeRatio = volatility > 0 ? (annualizedReturn - riskFreeRate) / volatility : 0;

    // Calculate profit factor
    const grossProfit = trades.filter((t) => (t.totalValue ?? 0) > 0).reduce((sum, t) => sum + (t.totalValue ?? 0), 0);
    const grossLoss = Math.abs(
      trades.filter((t) => (t.totalValue ?? 0) < 0).reduce((sum, t) => sum + (t.totalValue ?? 0), 0)
    );
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 1;

    return {
      sharpeRatio,
      totalReturn,
      maxDrawdown: -maxDrawdown, // Convention: negative for drawdown
      winRate,
      volatility,
      profitFactor: Math.min(profitFactor, 10), // Cap at 10 to avoid infinity issues
      tradeCount: totalTrades,
      annualizedReturn,
      finalValue
    };
  }
}
