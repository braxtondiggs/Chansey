import { Injectable, Logger } from '@nestjs/common';

import { CompositeRegimeType, MarketRegimeType } from '@chansey/api-interfaces';

import { CompositeRegimeService } from './composite-regime.service';

import { TradingStyle } from '../algorithm/interfaces/trading-style.enum';
import { AlgorithmRegistry } from '../algorithm/registry/algorithm-registry.service';
import { toErrorInfo } from '../shared/error.util';

/** Per-coin regime data captured at snapshot time. */
export interface PerCoinRegime {
  composite: CompositeRegimeType;
  volatility: MarketRegimeType | null;
}

export interface RegimeSnapshot {
  /** Majority-vote universe regime across all coins in the user's selection. */
  universeRegime: CompositeRegimeType;
  /** Per-coin composite + volatility data, keyed by uppercase symbol. */
  perCoin: ReadonlyMap<string, PerCoinRegime>;
  btcTrendAboveSma: boolean;
  status: { stale: boolean; ageMs: number };
}

export type FitnessDecision =
  | 'ALLOW'
  | 'ALLOW_OVERRIDE'
  | 'ALLOW_STALE'
  | 'ALLOW_UNKNOWN_STYLE'
  | 'ALLOW_ERROR'
  | 'BLOCK';

export interface FitnessResult {
  decision: FitnessDecision;
  reason: string;
  style?: TradingStyle;
}

/**
 * Pipeline-level regime fitness gate.
 *
 * Classifies each strategy by `TradingStyle` and skips incompatible ones using
 * a per-coin composite regime (majority vote across the user's universe) before
 * any OPTIMIZE compute is spent.
 *
 * Fail-open by design: override + staleness + unknown-style + thrown-error all
 * yield an ALLOW_* decision. The gate only blocks when the data clearly shows
 * a (style, regime) pairing is broken.
 */
@Injectable()
export class RegimeFitnessService {
  private readonly logger = new Logger(RegimeFitnessService.name);

  constructor(
    private readonly compositeRegimeService: CompositeRegimeService,
    private readonly algorithmRegistry: AlgorithmRegistry
  ) {}

  /**
   * Compute per-coin composites + majority-vote universe regime for the given
   * symbol set. Called once per user before iterating that user's strategies.
   */
  async snapshotRegime(coinSymbols: string[]): Promise<RegimeSnapshot> {
    const entries = await Promise.all(
      coinSymbols.map(async (symbol): Promise<[string, PerCoinRegime]> => {
        const upper = symbol.toUpperCase();
        const composite = await this.compositeRegimeService.getCompositeRegimeForCoin(upper);
        const volatility = this.compositeRegimeService.getVolatilityRegimeForCoin(upper);
        return [upper, { composite, volatility }];
      })
    );
    const perCoin = new Map<string, PerCoinRegime>(entries);
    return {
      universeRegime: this.majorityVote(perCoin),
      perCoin,
      btcTrendAboveSma: this.compositeRegimeService.getTrendAboveSma(),
      status: this.compositeRegimeService.getCacheStatus()
    };
  }

  /**
   * Synchronous decision — no DB calls. Called once per (user, strategy) pair
   * inside the orchestration loop.
   */
  evaluate(strategyId: string, snapshot: RegimeSnapshot): FitnessResult {
    try {
      if (this.compositeRegimeService.isOverrideActive()) {
        return { decision: 'ALLOW_OVERRIDE', reason: 'manual override active' };
      }

      if (snapshot.status.stale) {
        return {
          decision: 'ALLOW_STALE',
          reason: `regime data stale (${Math.round(snapshot.status.ageMs / 60_000)}min)`
        };
      }

      const style = this.algorithmRegistry.getStrategy(strategyId)?.tradingStyle;
      if (!style) {
        return { decision: 'ALLOW_UNKNOWN_STYLE', reason: `${strategyId} not registered` };
      }

      if (
        style === TradingStyle.TREND_FOLLOWING &&
        snapshot.universeRegime === CompositeRegimeType.NEUTRAL &&
        this.universeHasLowVolatility(snapshot)
      ) {
        return {
          decision: 'BLOCK',
          reason: 'TREND_FOLLOWING in NEUTRAL universe with low-volatility coin(s)',
          style
        };
      }

      if (style === TradingStyle.VOLATILITY_EXPANSION && this.universeHasLowVolatility(snapshot)) {
        return {
          decision: 'BLOCK',
          reason: 'VOLATILITY_EXPANSION needs vol expansion; universe contains low-volatility coin(s)',
          style
        };
      }

      return { decision: 'ALLOW', reason: 'fits regime', style };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Fitness evaluation failed for ${strategyId}: ${err.message}`);
      return { decision: 'ALLOW_ERROR', reason: 'evaluator threw — failing open' };
    }
  }

  /**
   * Majority-vote across per-coin composites. Falls back to BTC-global on ties
   * or empty universes.
   */
  private majorityVote(perCoin: Map<string, PerCoinRegime>): CompositeRegimeType {
    if (perCoin.size === 0) return this.compositeRegimeService.getCompositeRegime();
    const counts = new Map<CompositeRegimeType, number>();
    for (const entry of perCoin.values()) {
      counts.set(entry.composite, (counts.get(entry.composite) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (sorted.length === 1 || sorted[0][1] > sorted[1][1]) return sorted[0][0];
    return this.compositeRegimeService.getCompositeRegime();
  }

  /**
   * True if any coin in the snapshot has a `LOW_VOLATILITY` regime.
   * The composite already reflects volatility + trend, but the gate's BLOCK
   * rules need the raw `MarketRegimeType` to detect low-vol specifically.
   */
  private universeHasLowVolatility(snapshot: RegimeSnapshot): boolean {
    for (const entry of snapshot.perCoin.values()) {
      if (entry.volatility === MarketRegimeType.LOW_VOLATILITY) return true;
    }
    return false;
  }
}
