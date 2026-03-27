import { Injectable, Logger } from '@nestjs/common';

import { StrategyConfig } from './entities/strategy-config.entity';
import { UserStrategyPosition } from './entities/user-strategy-position.entity';

import {
  TradingSignal as AlgorithmTradingSignal,
  SignalType
} from '../algorithm/interfaces/algorithm-result.interface';
import { AlgorithmRegistry } from '../algorithm/registry/algorithm-registry.service';
import { AlgorithmContextBuilder } from '../algorithm/services/algorithm-context-builder.service';
import { CompositeRegimeService } from '../market-regime/composite-regime.service';
import { MetricsService } from '../metrics/metrics.service';
import { SignalThrottleService, ThrottleState } from '../order/backtest/shared/throttle';
import { ExitConfig } from '../order/interfaces/exit-config.interface';
import { toErrorInfo } from '../shared/error.util';

export interface TradingSignal {
  action: 'buy' | 'sell' | 'hold' | 'short_entry' | 'short_exit';
  symbol: string;
  quantity: number;
  price: number;
  reason?: string;
  /** Signal confidence (0-1), passed through from the algorithm */
  confidence?: number;
  /** Strategy-provided exit configuration (per-signal > result-level) */
  exitConfig?: Partial<ExitConfig>;
}

export interface MarketData {
  symbol: string;
  price: number;
  timestamp: Date;
  volume?: number;
}

const MIN_CONFIDENCE_THRESHOLD = 0.5;

/** Maximum allocation per trade (20% of strategy's allocated capital) */
const MAX_PER_TRADE_ALLOCATION = 0.2;
/** Minimum allocation per trade (5% of strategy's allocated capital) */
const MIN_PER_TRADE_ALLOCATION = 0.05;

/**
 * Executes trading strategies and generates buy/sell signals.
 * Wraps AlgorithmRegistry to run strategy logic with market data and positions.
 */
@Injectable()
export class StrategyExecutorService {
  private readonly logger = new Logger(StrategyExecutorService.name);

  private static readonly PRUNE_THRESHOLD = 100;
  private static readonly STALE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

  /** Per-strategy throttle state persisted across cron cycles (keyed by strategy config ID) */
  private readonly throttleStates = new Map<string, { state: ThrottleState; lastAccessedAt: number }>();

  constructor(
    private readonly algorithmRegistry: AlgorithmRegistry,
    private readonly algorithmContextBuilder: AlgorithmContextBuilder,
    private readonly signalThrottle: SignalThrottleService,
    private readonly compositeRegimeService: CompositeRegimeService,
    private readonly metricsService: MetricsService
  ) {}

  /** Get or create throttle state for a strategy, with last-access tracking */
  private getThrottleState(strategyId: string): ThrottleState {
    const now = Date.now();
    let entry = this.throttleStates.get(strategyId);
    if (!entry) {
      entry = { state: this.signalThrottle.createState(), lastAccessedAt: now };
      this.throttleStates.set(strategyId, entry);
    } else {
      entry.lastAccessedAt = now;
    }

    // Opportunistic pruning when map grows too large
    if (this.throttleStates.size > StrategyExecutorService.PRUNE_THRESHOLD) {
      const cutoff = now - StrategyExecutorService.STALE_AGE_MS;
      for (const [key, val] of this.throttleStates) {
        if (val.lastAccessedAt < cutoff) this.throttleStates.delete(key);
      }
    }

    return entry.state;
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
      context.compositeRegime = this.compositeRegimeService.getCompositeRegime();
      context.volatilityRegime = this.compositeRegimeService.getVolatilityRegime();

      // Pass marketType so strategies can detect futures mode for short signals
      context.metadata = {
        ...context.metadata,
        marketType: strategy.marketType ?? 'spot'
      };

      // Execute the algorithm
      const result = await this.algorithmRegistry.executeAlgorithm(strategy.algorithm.id, context);

      if (!result.success || !result.signals || result.signals.length === 0) {
        this.logger.debug(`Strategy ${strategy.id} produced no actionable signals`);
        return null;
      }

      // Filter to actionable signals (BUY/SELL/SHORT_ENTRY/SHORT_EXIT) meeting the confidence threshold
      const actionableSignals = result.signals.filter(
        (s) => s.type !== SignalType.HOLD && s.confidence >= MIN_CONFIDENCE_THRESHOLD
      );

      if (actionableSignals.length === 0) {
        this.logger.debug(`Strategy ${strategy.id}: all signals below confidence threshold`);
        return null;
      }

      // Apply signal throttle: cooldowns, daily cap, min sell %
      const throttleState = this.getThrottleState(strategy.id);
      const throttleConfig = this.signalThrottle.resolveConfig(
        strategy.parameters as Record<string, unknown> | undefined
      );
      const throttleInput = actionableSignals.map((s) => this.signalThrottle.toThrottleSignal(s));
      const throttleOutput = this.signalThrottle.filterSignals(
        throttleInput,
        throttleState,
        throttleConfig,
        Date.now()
      );

      if (throttleInput.length > throttleOutput.length) {
        const suppressedCount = throttleInput.length - throttleOutput.length;
        this.metricsService.recordSignalThrottleSuppressed(strategy.id, suppressedCount);
        this.logger.debug(`Strategy ${strategy.id}: throttled ${suppressedCount}/${throttleInput.length} signals`);
      }
      if (throttleOutput.length === 0) {
        this.logger.debug(`Strategy ${strategy.id}: all signals suppressed by throttle`);
        return null;
      }

      // Map accepted throttle signals back to original algorithm signals
      const acceptedKeys = new Set(throttleOutput.map((s) => `${s.coinId}:${s.action}`));
      const surviving = actionableSignals.filter((s) => {
        const t = this.signalThrottle.toThrottleSignal(s);
        return acceptedKeys.has(`${t.coinId}:${t.action}`);
      });

      surviving.sort((a, b) => b.confidence - a.confidence);
      const best = surviving[0];

      const signal = this.mapAlgorithmSignal(best, context.coins, marketData, availableCapital, result.exitConfig);
      if (!signal) {
        this.logger.warn(`Strategy ${strategy.id}: could not map algorithm signal to trading signal`);
        return null;
      }

      this.metricsService.recordSignalThrottlePassed(strategy.id, signal.action);
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

    if (signal.action === 'buy' || signal.action === 'short_entry') {
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

  private mapSignalType(type: SignalType): 'buy' | 'sell' | 'hold' | 'short_entry' | 'short_exit' {
    switch (type) {
      case SignalType.BUY:
        return 'buy';
      case SignalType.SELL:
      case SignalType.STOP_LOSS:
      case SignalType.TAKE_PROFIT:
        return 'sell';
      case SignalType.SHORT_ENTRY:
        return 'short_entry';
      case SignalType.SHORT_EXIT:
        return 'short_exit';
      case SignalType.HOLD:
      default:
        return 'hold';
    }
  }

  private mapAlgorithmSignal(
    signal: AlgorithmTradingSignal,
    coins: Array<{ id: string; symbol: string }>,
    marketData: MarketData[],
    availableCapital: number,
    resultExitConfig?: Partial<ExitConfig>
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
    let quantity = signal.quantity || (availableCapital * signal.strength) / price;

    const action = this.mapSignalType(signal.type);

    // Cap per-trade position size for buy/short_entry signals (mirrors paper trading MAX_ALLOCATION)
    // Sell and short_exit signals are bounded by existing position size, so no cap needed.
    if (action === 'buy' || action === 'short_entry') {
      const maxQuantity = (availableCapital * MAX_PER_TRADE_ALLOCATION) / price;
      const minQuantity = (availableCapital * MIN_PER_TRADE_ALLOCATION) / price;
      if (quantity > maxQuantity) {
        this.logger.warn(
          `Capping ${symbol} quantity from ${quantity.toFixed(8)} to ${maxQuantity.toFixed(8)} (${(MAX_PER_TRADE_ALLOCATION * 100).toFixed(0)}% cap)`
        );
        quantity = maxQuantity;
      } else if (quantity < minQuantity && quantity > 0) {
        this.logger.warn(
          `Flooring ${symbol} quantity from ${quantity.toFixed(8)} to ${minQuantity.toFixed(8)} (${(MIN_PER_TRADE_ALLOCATION * 100).toFixed(0)}% floor)`
        );
        quantity = minQuantity;
      }
    }

    // Per-signal exitConfig takes priority over result-level exitConfig
    const exitConfig = signal.exitConfig ?? resultExitConfig;

    return {
      action,
      symbol,
      quantity,
      price,
      reason: signal.reason,
      confidence: signal.confidence,
      exitConfig
    };
  }

  private convertPositions(
    positions: UserStrategyPosition[],
    coins: Array<{ id: string; symbol: string }>
  ): Record<string, number> {
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
