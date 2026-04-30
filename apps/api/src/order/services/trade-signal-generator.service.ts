import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { MarketType, SignalReasonCode } from '@chansey/api-interfaces';

import { AlgorithmActivation } from '../../algorithm/algorithm-activation.entity';
import { SignalType, TradingSignal } from '../../algorithm/interfaces';
import { AlgorithmRegistry } from '../../algorithm/registry/algorithm-registry.service';
import { AlgorithmContextBuilder } from '../../algorithm/services/algorithm-context-builder.service';
import { CoinService } from '../../coin/coin.service';
import { DEFAULT_QUOTE_CURRENCY, EXCHANGE_QUOTE_CURRENCY } from '../../exchange/constants';
import { ExchangeSelectionService } from '../../exchange/exchange-selection/exchange-selection.service';
import { toErrorInfo } from '../../shared/error.util';
import { StrategyConfig } from '../../strategy/entities/strategy-config.entity';
import { SignalThrottleService, ThrottleState } from '../backtest/shared/throttle';
import { TradeSignalWithExit } from '../interfaces/trade-signal.interface';

export interface GenerateSignalResult {
  signal: TradeSignalWithExit | null;
  skipReason?: {
    reasonCode: SignalReasonCode;
    reason: string;
    metadata?: Record<string, unknown>;
    partialSignal?: { action?: 'BUY' | 'SELL'; symbol?: string; confidence?: number; positionSide?: 'long' | 'short' };
  };
}

export const MIN_CONFIDENCE_THRESHOLD = 0.6;
export const ACTIONABLE_SIGNAL_TYPES = new Set([
  SignalType.BUY,
  SignalType.SELL,
  SignalType.SHORT_ENTRY,
  SignalType.SHORT_EXIT
]);

/**
 * Generates trade signals from algorithm activations.
 * Handles strategy evaluation, signal filtering, throttling, symbol resolution, and exchange selection.
 */
@Injectable()
export class TradeSignalGeneratorService {
  private readonly logger = new Logger(TradeSignalGeneratorService.name);

  private static readonly MAX_THROTTLE_STATES = 1000;

  /** Per-activation throttle state persisted across cron cycles (keyed by activation ID) */
  private readonly throttleStates = new Map<string, ThrottleState>();

  constructor(
    @InjectRepository(StrategyConfig)
    private readonly strategyConfigRepo: Repository<StrategyConfig>,
    private readonly algorithmRegistry: AlgorithmRegistry,
    private readonly contextBuilder: AlgorithmContextBuilder,
    private readonly coinService: CoinService,
    private readonly signalThrottle: SignalThrottleService,
    private readonly exchangeSelectionService: ExchangeSelectionService
  ) {}

  /**
   * Generate a trade signal for an algorithm activation.
   * @returns TradeSignalWithExit or null if no actionable trade
   */
  async generateTradeSignal(activation: AlgorithmActivation, portfolioValue: number): Promise<GenerateSignalResult> {
    const algorithm = activation.algorithm;

    if (!algorithm.strategyId && !algorithm.service) {
      this.logger.debug(`Algorithm ${algorithm.name} has no strategy configured, skipping`);
      return { signal: null };
    }

    const context = await this.contextBuilder.buildContext(algorithm);

    if (!this.contextBuilder.validateContext(context)) {
      this.logger.debug(`Context validation failed for algorithm ${algorithm.name}, skipping`);
      return { signal: null };
    }

    const result = await this.algorithmRegistry.executeAlgorithm(activation.algorithmId, context);

    if (!result.success || !result.signals || result.signals.length === 0) {
      return { signal: null };
    }

    const actionableSignals = result.signals.filter(
      (s) => ACTIONABLE_SIGNAL_TYPES.has(s.type) && s.confidence >= MIN_CONFIDENCE_THRESHOLD
    );

    if (actionableSignals.length === 0) {
      return { signal: null };
    }

    // Apply signal throttle: cooldowns, daily cap, min sell %
    const throttleState = this.getThrottleState(activation.id);
    const throttleConfig = this.signalThrottle.resolveConfig(activation.config as Record<string, unknown> | undefined);
    const throttleInput = actionableSignals.map((s) => this.signalThrottle.toThrottleSignal(s));
    const now = Date.now();
    const throttleOutput = this.signalThrottle.filterSignals(
      throttleInput,
      throttleState,
      throttleConfig,
      now
    ).accepted;

    // Throttle stamping is deferred to markExecuted(), which the orchestrator
    // invokes only after tradeExecutionService.executeTradeSignal succeeds.
    // This prevents runners-up (the N-1 signals discarded by the strength ×
    // confidence pick below) and signals dropped by downstream entry gates
    // from burning a 24h cooldown.

    if (throttleOutput.length === 0) {
      const bestThrottled = actionableSignals.reduce((best, cur) =>
        cur.strength * cur.confidence > best.strength * best.confidence ? cur : best
      );
      return {
        signal: null,
        skipReason: {
          reasonCode: SignalReasonCode.SIGNAL_THROTTLED,
          reason: `All ${actionableSignals.length} actionable signal(s) filtered by throttle`,
          metadata: { filteredCount: actionableSignals.length },
          partialSignal: {
            action: this.mapSignalToAction(bestThrottled.type, 'spot')?.action,
            symbol: bestThrottled.coinId,
            confidence: bestThrottled.confidence,
            positionSide: this.mapSignalToAction(bestThrottled.type, 'spot')?.positionSide
          }
        }
      };
    }

    // Map accepted throttle signals back to original algorithm signals
    const acceptedKeys = new Set(throttleOutput.map((s) => `${s.coinId}:${s.action}`));
    const surviving = actionableSignals.filter((s) => {
      const t = this.signalThrottle.toThrottleSignal(s);
      return acceptedKeys.has(`${t.coinId}:${t.action}`);
    });

    // Pick the strongest signal by strength × confidence
    const bestSignal = surviving.reduce((best: TradingSignal, current: TradingSignal) =>
      current.strength * current.confidence > best.strength * best.confidence ? current : best
    );

    const exitConfig = bestSignal.exitConfig ?? result.exitConfig;

    // Resolve trading symbol
    const symbol = await this.resolveTradingSymbol(bestSignal.coinId);
    if (!symbol) {
      this.logger.warn(`Could not resolve trading symbol for coin ${bestSignal.coinId}, skipping`);
      return {
        signal: null,
        skipReason: {
          reasonCode: SignalReasonCode.SYMBOL_RESOLUTION_FAILED,
          reason: `Could not resolve trading symbol for coin ${bestSignal.coinId}`,
          metadata: { coinId: bestSignal.coinId },
          partialSignal: { confidence: bestSignal.confidence }
        }
      };
    }

    const marketContext = await this.resolveMarketContext(activation);
    const mapped = this.mapSignalToAction(bestSignal.type, marketContext.marketType);
    if (!mapped) {
      this.logger.warn(`Unknown signal type ${bestSignal.type} for activation ${activation.id}, skipping`);
      return {
        signal: null,
        skipReason: {
          reasonCode: SignalReasonCode.SIGNAL_VALIDATION_FAILED,
          reason: `Unknown signal type ${bestSignal.type} for activation ${activation.id}`,
          metadata: { signalType: bestSignal.type },
          partialSignal: { symbol, confidence: bestSignal.confidence }
        }
      };
    }
    const { action, positionSide } = mapped;

    // Dynamically select exchange key
    let exchangeKey;
    try {
      exchangeKey =
        action === 'BUY'
          ? await this.exchangeSelectionService.selectForBuy(activation.userId, symbol)
          : await this.exchangeSelectionService.selectForSell(activation.userId, symbol);
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.warn(`Exchange selection failed for activation ${activation.id}: ${err.message}`);
      return {
        signal: null,
        skipReason: {
          reasonCode: SignalReasonCode.EXCHANGE_SELECTION_FAILED,
          reason: `Exchange selection failed: ${err.message}`,
          metadata: { errorMessage: err.message },
          partialSignal: { action, symbol, confidence: bestSignal.confidence, positionSide }
        }
      };
    }

    // Re-resolve symbol with correct exchange-specific quote currency if needed
    const exchangeSlug = exchangeKey.exchange?.slug;
    const finalSymbol = exchangeSlug
      ? ((await this.resolveTradingSymbol(bestSignal.coinId, exchangeSlug)) ?? symbol)
      : symbol;

    return {
      signal: {
        algorithmActivationId: activation.id,
        userId: activation.userId,
        exchangeKeyId: exchangeKey.id,
        action,
        symbol: finalSymbol,
        quantity: 0,
        confidence: bestSignal.confidence,
        autoSize: true,
        portfolioValue,
        allocationPercentage: activation.allocationPercentage || 5.0,
        marketType: marketContext.marketType,
        leverage: marketContext.leverage,
        positionSide,
        exitConfig,
        coinId: bestSignal.coinId,
        originalType: bestSignal.type
      }
    };
  }

  /**
   * Stamp the throttle ledger for a signal that was actually executed on an exchange.
   * Mirrors the deferral pattern in paper-trading-engine: callers invoke this only
   * on the success branch of executeTradeSignal so silent-drops by downstream
   * entry gates and runners-up never burn a 24h cooldown.
   *
   * Bypass signals (STOP_LOSS / TAKE_PROFIT / SHORT_EXIT) are intentionally skipped.
   */
  markExecuted(activationId: string, signal: TradeSignalWithExit): void {
    this.signalThrottle.markExecutedFromAlgo(
      this.throttleStates.get(activationId),
      signal.originalType,
      signal.coinId,
      Date.now()
    );
  }

  /** Prune throttle states for deactivated activations to prevent unbounded growth */
  pruneThrottleStates(activeIds: Set<string>): void {
    for (const key of this.throttleStates.keys()) {
      if (!activeIds.has(key)) this.throttleStates.delete(key);
    }
  }

  /**
   * Resolve market context (spot vs futures, leverage) for an activation.
   * Checks activation-level override first, then falls back to StrategyConfig.
   */
  private async resolveMarketContext(
    activation: AlgorithmActivation
  ): Promise<{ marketType: 'spot' | 'futures'; leverage: number }> {
    const meta = activation.config?.metadata as Record<string, unknown> | undefined;
    if (meta?.marketType === MarketType.FUTURES) {
      return { marketType: 'futures', leverage: Number(meta.leverage) || 1 };
    }

    try {
      const strategyConfig = await this.strategyConfigRepo.findOne({
        where: { algorithmId: activation.algorithmId, shadowStatus: 'live' }
      });

      if (strategyConfig?.marketType === MarketType.FUTURES) {
        return { marketType: 'futures', leverage: Number(strategyConfig.defaultLeverage) || 1 };
      }
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.debug(`Could not look up StrategyConfig for algorithm ${activation.algorithmId}: ${err.message}`);
    }

    return { marketType: 'spot', leverage: 1 };
  }

  /** Map an algorithm SignalType to the action/positionSide that TradeExecutionService expects. */
  private mapSignalToAction(
    signalType: SignalType,
    marketType: 'spot' | 'futures'
  ): { action: 'BUY' | 'SELL'; positionSide?: 'long' | 'short' } | null {
    switch (signalType) {
      case SignalType.SHORT_ENTRY:
        return { action: 'SELL', positionSide: 'short' };
      case SignalType.SHORT_EXIT:
        return { action: 'BUY', positionSide: 'short' };
      case SignalType.BUY:
        return { action: 'BUY', positionSide: marketType === 'futures' ? 'long' : undefined };
      case SignalType.SELL:
        return { action: 'SELL', positionSide: marketType === 'futures' ? 'long' : undefined };
      default:
        return null;
    }
  }

  /** Resolve a coin ID into a trading symbol (e.g. "BTC/USDT") */
  private async resolveTradingSymbol(coinId: string, exchangeSlug?: string): Promise<string | null> {
    try {
      const coin = await this.coinService.getCoinById(coinId);
      const quoteCurrency = exchangeSlug
        ? EXCHANGE_QUOTE_CURRENCY[exchangeSlug] || DEFAULT_QUOTE_CURRENCY
        : DEFAULT_QUOTE_CURRENCY;
      return `${coin.symbol.toUpperCase()}/${quoteCurrency}`;
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to resolve trading symbol for coin ${coinId}: ${err.message}`);
      return null;
    }
  }

  /** Get or create throttle state for an activation */
  private getThrottleState(activationId: string): ThrottleState {
    if (this.throttleStates.size > TradeSignalGeneratorService.MAX_THROTTLE_STATES) {
      const evictCount = Math.floor(this.throttleStates.size / 2);
      let removed = 0;
      for (const key of this.throttleStates.keys()) {
        if (removed >= evictCount) break;
        if (key !== activationId) {
          this.throttleStates.delete(key);
          removed++;
        }
      }
    }
    let state = this.throttleStates.get(activationId);
    if (!state) {
      state = this.signalThrottle.createState();
      this.throttleStates.set(activationId, state);
    }
    return state;
  }
}
