import { Injectable, Logger } from '@nestjs/common';

import { StrategyConfig } from './entities/strategy-config.entity';
import { UserStrategyPosition } from './entities/user-strategy-position.entity';

import {
  TradingSignal as AlgorithmTradingSignal,
  SignalType
} from '../algorithm/interfaces/algorithm-result.interface';
import { AlgorithmRegistry } from '../algorithm/registry/algorithm-registry.service';
import { AlgorithmContextBuilder } from '../algorithm/services/algorithm-context-builder.service';
import { Coin } from '../coin/coin.entity';
import { SignalThrottleService, ThrottleState } from '../order/backtest/shared/throttle';
import { toErrorInfo } from '../shared/error.util';

export interface TradingSignal {
  action: 'buy' | 'sell' | 'hold';
  symbol: string;
  quantity: number;
  price: number;
  reason?: string;
}

export interface MarketData {
  symbol: string;
  price: number;
  timestamp: Date;
  volume?: number;
}

const MIN_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Executes trading strategies and generates buy/sell signals.
 * Wraps AlgorithmRegistry to run strategy logic with market data and positions.
 */
@Injectable()
export class StrategyExecutorService {
  private readonly logger = new Logger(StrategyExecutorService.name);

  /** Per-strategy throttle state persisted across cron cycles (keyed by strategy config ID) */
  private readonly throttleStates = new Map<string, ThrottleState>();

  constructor(
    private readonly algorithmRegistry: AlgorithmRegistry,
    private readonly algorithmContextBuilder: AlgorithmContextBuilder,
    private readonly signalThrottle: SignalThrottleService
  ) {}

  /** Get or create throttle state for a strategy */
  private getThrottleState(strategyId: string): ThrottleState {
    let state = this.throttleStates.get(strategyId);
    if (!state) {
      state = this.signalThrottle.createState();
      this.throttleStates.set(strategyId, state);
    }
    return state;
  }

  async executeStrategy(
    strategy: StrategyConfig,
    marketData: MarketData[],
    positions: UserStrategyPosition[],
    availableCapital: number
  ): Promise<TradingSignal | null> {
    try {
      // Build context from algorithm entity (coins + OHLC data)
      const context = await this.algorithmContextBuilder.buildContext(strategy.algorithm, {
        includePositions: false
      });

      // Merge strategy-specific parameters into config
      context.config = { ...context.config, ...strategy.parameters };
      context.availableBalance = availableCapital;
      context.positions = this.convertPositions(positions, context.coins);

      // Execute the algorithm
      const result = await this.algorithmRegistry.executeAlgorithm(strategy.algorithm.id, context);

      if (!result.success || !result.signals || result.signals.length === 0) {
        this.logger.debug(`Strategy ${strategy.id} produced no actionable signals`);
        return null;
      }

      // Filter to BUY/SELL signals meeting the confidence threshold
      const actionableSignals = result.signals.filter(
        (s) => s.type !== SignalType.HOLD && s.confidence >= MIN_CONFIDENCE_THRESHOLD
      );

      if (actionableSignals.length === 0) {
        this.logger.debug(`Strategy ${strategy.id}: all signals below confidence threshold`);
        return null;
      }

      // Sort by confidence descending and take the best
      actionableSignals.sort((a, b) => b.confidence - a.confidence);
      const best = actionableSignals[0];

      const signal = this.mapAlgorithmSignal(best, context.coins, marketData, availableCapital);
      if (!signal) {
        this.logger.warn(`Strategy ${strategy.id}: could not map algorithm signal to trading signal`);
        return null;
      }

      this.logger.log(
        `Strategy ${strategy.id} generated ${signal.action} signal for ${signal.symbol} at ${signal.price}`
      );

      return signal;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Error executing strategy ${strategy.id}: ${err.message}`);
      return null;
    }
  }

  async executeMultipleStrategies(
    strategies: StrategyConfig[],
    marketData: MarketData[],
    positions: UserStrategyPosition[],
    capitalPerStrategy: Map<string, number>
  ): Promise<Map<string, TradingSignal | null>> {
    const results = await Promise.allSettled(
      strategies.map(async (strategy) => {
        const capital = capitalPerStrategy.get(strategy.id) || 0;
        const strategyPositions = positions.filter((p) => p.strategyConfigId === strategy.id);
        const signal = await this.executeStrategy(strategy, marketData, strategyPositions, capital);
        return [strategy.id, signal] as const;
      })
    );

    const signals = new Map<string, TradingSignal | null>();
    for (const result of results) {
      if (result.status === 'fulfilled') {
        signals.set(result.value[0], result.value[1]);
      } else {
        const err = toErrorInfo(result.reason);
        this.logger.error(`Strategy execution failed: ${err.message}`);
      }
    }

    return signals;
  }

  validateSignal(signal: TradingSignal, availableCapital: number): { valid: boolean; reason?: string } {
    if (!signal) {
      return { valid: false, reason: 'No signal provided' };
    }

    if (signal.action === 'hold') {
      return { valid: true };
    }

    if (signal.quantity <= 0) {
      return { valid: false, reason: 'Quantity must be greater than 0' };
    }

    if (signal.price <= 0) {
      return { valid: false, reason: 'Price must be greater than 0' };
    }

    if (signal.action === 'buy') {
      const requiredCapital = signal.quantity * signal.price;
      if (requiredCapital > availableCapital) {
        return {
          valid: false,
          reason: `Insufficient capital: need ${requiredCapital.toFixed(2)}, have ${availableCapital.toFixed(2)}`
        };
      }
    }

    return { valid: true };
  }

  private mapSignalType(type: SignalType): 'buy' | 'sell' | 'hold' {
    switch (type) {
      case SignalType.BUY:
        return 'buy';
      case SignalType.SELL:
      case SignalType.STOP_LOSS:
      case SignalType.TAKE_PROFIT:
        return 'sell';
      case SignalType.HOLD:
      default:
        return 'hold';
    }
  }

  private mapAlgorithmSignal(
    signal: AlgorithmTradingSignal,
    coins: Coin[],
    marketData: MarketData[],
    availableCapital: number
  ): TradingSignal | null {
    const coin = coins.find((c) => c.id === signal.coinId);
    if (!coin) {
      this.logger.warn(`Coin not found for signal coinId: ${signal.coinId}`);
      return null;
    }

    // Find matching market data entry for this coin
    // Prefer quote currencies in priority order (matches QuoteCurrencyResolverService pattern)
    const quotePreference = ['USDT', 'USDC', 'BUSD', 'DAI'];
    const marketEntry =
      quotePreference
        .map((q) => marketData.find((m) => m.symbol === `${coin.symbol}/${q}`))
        .find((entry) => entry != null) ?? marketData.find((m) => m.symbol.startsWith(`${coin.symbol}/`));

    const symbol = marketEntry?.symbol || `${coin.symbol}/USDT`;
    const price = signal.price || marketEntry?.price;

    if (!price || price <= 0) {
      this.logger.warn(`No valid price for ${symbol}`);
      return null;
    }

    // Use signal quantity or calculate a default from capital scaled by strength
    const quantity = signal.quantity || (availableCapital * signal.strength) / price;

    return {
      action: this.mapSignalType(signal.type),
      symbol,
      quantity,
      price,
      reason: signal.reason
    };
  }

  private convertPositions(positions: UserStrategyPosition[], coins: Coin[]): Record<string, number> {
    const result: Record<string, number> = {};

    for (const pos of positions) {
      // Position symbol is "BTC/USDT" or "BTCUSDT", coin symbol is "BTC"
      const baseSymbol = pos.symbol.includes('/')
        ? pos.symbol.split('/')[0]
        : pos.symbol.replace(/(?:USDT|USDC|BUSD|USD|EUR|BTC|ETH|BNB)$/i, '') || pos.symbol;
      const coin = coins.find((c) => c.symbol === baseSymbol);
      if (coin) {
        result[coin.id] = (result[coin.id] || 0) + Number(pos.quantity);
      }
    }

    return result;
  }
}
