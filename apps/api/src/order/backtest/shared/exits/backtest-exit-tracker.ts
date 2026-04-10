import {
  calculateStopLossPrice,
  calculateTakeProfitPrice,
  calculateTrailingActivationPrice,
  calculateTrailingStopPrice
} from './exit-price.utils';

import { type ExitConfig, TrailingActivationType, TrailingType } from '../../../interfaces/exit-config.interface';
import { resolveExitConfig } from '../../../utils/exit-config-merge.util';

/**
 * Type of exit that triggered position closure.
 */
export type ExitType = 'STOP_LOSS' | 'TAKE_PROFIT' | 'TRAILING_STOP';

/**
 * Signal emitted by the tracker when an exit level is breached.
 */
export interface ExitSignal {
  coinId: string;
  quantity: number;
  exitType: ExitType;
  executionPrice: number;
  reason: string;
  metadata: Record<string, unknown>;
}

/**
 * State for a single tracked position's exit levels.
 * Exported so SerializableExitTrackerState can reference the type directly.
 */
export interface TrackedExit {
  coinId: string;
  entryPrice: number;
  quantity: number;
  side: 'BUY' | 'SELL';
  stopLossPrice?: number;
  takeProfitPrice?: number;
  trailingStopPrice?: number;
  trailingActivationPrice?: number;
  trailingActivated: boolean;
  highWaterMark: number;
  entryAtr?: number;
  ocoLinked: boolean;
  /** Per-position exit config override (merged from strategy-provided exitConfig) */
  positionConfig?: ExitConfig;
}

/**
 * Serializable representation of the exit tracker for checkpoint persistence.
 */
export interface SerializableExitTrackerState {
  positions: TrackedExit[];
}

/**
 * In-memory position exit tracker for the backtest engine.
 *
 * Manages exit levels (SL, TP, trailing stop) for open positions and checks
 * each bar for breaches. Returns ExitSignal[] which the engine converts to
 * TradingSignals for execution.
 */
export class BacktestExitTracker {
  private positions = new Map<string, TrackedExit>();

  constructor(private readonly config: ExitConfig) {}

  /** Number of tracked positions */
  get size(): number {
    return this.positions.size;
  }

  /** Check if a coin has a tracked position */
  has(coinId: string): boolean {
    return this.positions.has(coinId);
  }

  /** Get the current exit levels for a position (read-only reference — do not mutate) */
  getExitLevels(coinId: string): Readonly<TrackedExit> | undefined {
    return this.positions.get(coinId);
  }

  /**
   * Register a new BUY position or scale into an existing one (cost-averaging).
   *
   * When a position already exists for `coinId`, the tracker computes a
   * weighted-average entry price, sums the quantities, and recalculates all
   * exit levels from the new averaged entry. Trailing activation state is
   * preserved so an already-activated trailing stop keeps ratcheting.
   */
  onBuy(
    coinId: string,
    entryPrice: number,
    quantity: number,
    currentAtr?: number,
    overrideExitConfig?: Partial<ExitConfig>
  ): void {
    // Resolve effective config: strategy override merged on top of tracker-level config
    const effectiveConfig = overrideExitConfig ? resolveExitConfig(this.config, overrideExitConfig) : this.config;

    const existing = this.positions.get(coinId);
    if (existing) {
      // Update positionConfig if a new override is provided
      if (overrideExitConfig) {
        existing.positionConfig = effectiveConfig;
      }
      const cfg = existing.positionConfig ?? this.config;

      // Cost-average: weighted-average entry, sum quantities, recalculate exit levels
      const totalQty = existing.quantity + quantity;
      const avgEntry = (existing.entryPrice * existing.quantity + entryPrice * quantity) / totalQty;
      existing.entryPrice = avgEntry;
      existing.quantity = totalQty;
      existing.highWaterMark = Math.max(existing.highWaterMark, entryPrice);
      existing.entryAtr = currentAtr ?? existing.entryAtr;

      if (cfg.enableStopLoss) {
        existing.stopLossPrice = calculateStopLossPrice(avgEntry, existing.side, cfg, existing.entryAtr);
      }
      if (cfg.enableTakeProfit) {
        existing.takeProfitPrice = calculateTakeProfitPrice(avgEntry, existing.side, cfg, existing.stopLossPrice);
      }
      if (cfg.enableTrailingStop) {
        existing.trailingStopPrice = existing.trailingActivated
          ? this.recalcTrailingStop(existing)
          : calculateTrailingStopPrice(avgEntry, existing.side, cfg, existing.entryAtr);
        existing.trailingActivationPrice = calculateTrailingActivationPrice(avgEntry, existing.side, cfg);
      }
      return;
    }

    const side: 'BUY' | 'SELL' = 'BUY';

    const tracked: TrackedExit = {
      coinId,
      entryPrice,
      quantity,
      side,
      trailingActivated: false,
      highWaterMark: entryPrice,
      entryAtr: currentAtr,
      ocoLinked: effectiveConfig.useOco,
      ...(overrideExitConfig ? { positionConfig: effectiveConfig } : {})
    };

    if (effectiveConfig.enableStopLoss) {
      tracked.stopLossPrice = calculateStopLossPrice(entryPrice, side, effectiveConfig, currentAtr);
    }

    if (effectiveConfig.enableTakeProfit) {
      tracked.takeProfitPrice = calculateTakeProfitPrice(entryPrice, side, effectiveConfig, tracked.stopLossPrice);
    }

    if (effectiveConfig.enableTrailingStop) {
      tracked.trailingStopPrice = calculateTrailingStopPrice(entryPrice, side, effectiveConfig, currentAtr);
      tracked.trailingActivationPrice = calculateTrailingActivationPrice(entryPrice, side, effectiveConfig);

      // Immediate activation means trailing is active from the start
      if (effectiveConfig.trailingActivation === TrailingActivationType.IMMEDIATE) {
        tracked.trailingActivated = true;
      }
    }

    this.positions.set(coinId, tracked);
  }

  /**
   * Reduce tracked quantity after a partial or full sell.
   * Removes the position entirely when quantity reaches zero.
   */
  onSell(coinId: string, quantitySold: number): void {
    const tracked = this.positions.get(coinId);
    if (!tracked) return;

    tracked.quantity -= quantitySold;
    if (tracked.quantity <= 0) {
      this.positions.delete(coinId);
    }
  }

  /** Remove tracking for a position entirely. */
  removePosition(coinId: string): void {
    this.positions.delete(coinId);
  }

  /**
   * Core per-bar exit check. Iterates all tracked positions and returns
   * ExitSignals for any that have breached their exit levels.
   *
   * @param closePrices - Map<coinId, close price> for the current bar
   * @param lowPrices - Map<coinId, low price> for SL breach detection
   * @param highPrices - Map<coinId, high price> for TP breach detection
   */
  checkExits(
    closePrices: Map<string, number>,
    lowPrices: Map<string, number>,
    highPrices: Map<string, number>
  ): ExitSignal[] {
    const signals: ExitSignal[] = [];

    for (const [coinId, tracked] of this.positions) {
      const closePrice = closePrices.get(coinId);
      if (!closePrice || closePrice <= 0) continue;

      const lowPrice = lowPrices.get(coinId) ?? closePrice;
      const highPrice = highPrices.get(coinId) ?? closePrice;

      let exited = false;

      // 1. Stop Loss check: breach when low touches/drops below stop level
      // SL is evaluated before TP intentionally — on wide candles where both
      // levels are breached in the same bar, this pessimistic ordering avoids
      // overstating strategy performance.
      if (!exited && tracked.stopLossPrice != null) {
        if (tracked.side === 'BUY' && lowPrice <= tracked.stopLossPrice) {
          // Execution price clamped to stop level (simulates limit-stop fill)
          signals.push({
            coinId,
            quantity: tracked.quantity,
            exitType: 'STOP_LOSS',
            executionPrice: tracked.stopLossPrice,
            reason: `Stop-loss triggered: low ${lowPrice.toFixed(2)} breached SL at ${tracked.stopLossPrice.toFixed(2)}`,
            metadata: {
              entryPrice: tracked.entryPrice,
              stopLossPrice: tracked.stopLossPrice,
              lowPrice
            }
          });
          exited = true;
          // OCO: if SL fires, TP is cancelled — handled by removing position below
        }
      }

      // 2. Take Profit check: breach when high touches/exceeds TP level
      if (!exited && tracked.takeProfitPrice != null) {
        if (tracked.side === 'BUY' && highPrice >= tracked.takeProfitPrice) {
          signals.push({
            coinId,
            quantity: tracked.quantity,
            exitType: 'TAKE_PROFIT',
            executionPrice: tracked.takeProfitPrice,
            reason: `Take-profit triggered: high ${highPrice.toFixed(2)} breached TP at ${tracked.takeProfitPrice.toFixed(2)}`,
            metadata: {
              entryPrice: tracked.entryPrice,
              takeProfitPrice: tracked.takeProfitPrice,
              highPrice
            }
          });
          exited = true;
          // OCO: if TP fires, SL is cancelled
        }
      }

      // 3. Trailing Stop: update activation → high water mark → recalc → check breach
      const posConfig = tracked.positionConfig ?? this.config;
      if (!exited && posConfig.enableTrailingStop && tracked.trailingStopPrice != null) {
        // Check activation if not yet activated
        if (!tracked.trailingActivated && tracked.trailingActivationPrice != null) {
          if (tracked.side === 'BUY' && highPrice >= tracked.trailingActivationPrice) {
            tracked.trailingActivated = true;
          }
        }

        if (tracked.trailingActivated) {
          // Update high water mark
          if (highPrice > tracked.highWaterMark) {
            tracked.highWaterMark = highPrice;
            // Recalculate trailing stop from new high water mark
            tracked.trailingStopPrice = this.recalcTrailingStop(tracked);
          }

          // Check breach
          if (tracked.side === 'BUY' && lowPrice <= tracked.trailingStopPrice) {
            signals.push({
              coinId,
              quantity: tracked.quantity,
              exitType: 'TRAILING_STOP',
              executionPrice: tracked.trailingStopPrice,
              reason: `Trailing stop triggered: low ${lowPrice.toFixed(2)} breached trailing at ${tracked.trailingStopPrice.toFixed(2)}`,
              metadata: {
                entryPrice: tracked.entryPrice,
                highWaterMark: tracked.highWaterMark,
                trailingStopPrice: tracked.trailingStopPrice,
                lowPrice
              }
            });
            exited = true;
          }
        }
      }

      // If exited by any mechanism, no further checks for this coin this bar
      // (OCO is implicitly handled — only one signal per position per bar)
    }

    return signals;
  }

  /**
   * Recalculate trailing stop price from the current high water mark.
   *
   * Note: For ATR-based trailing, `entryAtr` is frozen at position open time
   * (or latest scale-in). Recomputing ATR per-bar would require access to the
   * full OHLC window, which the tracker intentionally does not hold. This is a
   * known simplification; live trading would use a rolling ATR instead.
   */
  private recalcTrailingStop(tracked: TrackedExit): number {
    const cfg = tracked.positionConfig ?? this.config;
    let distance: number;

    switch (cfg.trailingType) {
      case TrailingType.AMOUNT:
        distance = cfg.trailingValue;
        break;

      case TrailingType.PERCENTAGE:
        distance = tracked.highWaterMark * (cfg.trailingValue / 100);
        break;

      case TrailingType.ATR:
        if (!tracked.entryAtr || isNaN(tracked.entryAtr)) {
          distance = tracked.highWaterMark * 0.01; // 1% fallback
        } else {
          distance = tracked.entryAtr * cfg.trailingValue;
        }
        break;

      default:
        distance = tracked.highWaterMark * 0.01;
    }

    return tracked.side === 'BUY' ? tracked.highWaterMark - distance : tracked.highWaterMark + distance;
  }

  /**
   * Serialize tracker state for checkpoint persistence.
   */
  serialize(): SerializableExitTrackerState {
    return {
      positions: Array.from(this.positions.values()).map((t) => ({ ...t }))
    };
  }

  /**
   * Restore a tracker from serialized state (for checkpoint-resume).
   */
  static deserialize(state: SerializableExitTrackerState, config: ExitConfig): BacktestExitTracker {
    const tracker = new BacktestExitTracker(config);
    for (const pos of state.positions) {
      tracker.positions.set(pos.coinId, { ...pos });
    }
    return tracker;
  }
}
