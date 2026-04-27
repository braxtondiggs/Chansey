import type { Repository, SelectQueryBuilder } from 'typeorm';

import { type CoinDiversityService, SHORTLIST_MULTIPLIER } from './coin-diversity.service';
import { MIN_DAILY_VOLUME, MIN_MARKET_CAP } from './coin-quality.constants';
import { type Coin } from './coin.entity';

import { STABLECOIN_SYMBOLS } from '../exchange/constants';

/** Weight applied to the sentiment nudge when blending with the primary score. */
const SENTIMENT_WEIGHT = 0.1;
/** Level-5 mid-cap band: excludes mega-caps and dust. */
const LEVEL_5_MIN_MARKET_CAP = 50_000_000;
const LEVEL_5_MAX_MARKET_CAP = 5_000_000_000;
/**
 * Minimum OHLC freshness for risk-level eligibility. A coin with an active
 * exchange_symbol_map row but no recent candles cannot be reliably priced by
 * the realtime ticker, so it must not enter coin selection.
 */
export const MIN_OHLC_FRESHNESS_HOURS = 24;

type RiskLevelWeights = { size: number; liq: number; mo7: number; mo30: number };

const RISK_LEVEL_WEIGHTS: Record<number, RiskLevelWeights> = {
  1: { size: 0.55, liq: 0.45, mo7: 0, mo30: 0 },
  2: { size: 0.45, liq: 0.4, mo7: 0, mo30: 0.15 },
  3: { size: 0.35, liq: 0.35, mo7: 0.15, mo30: 0.15 },
  4: { size: 0.25, liq: 0.35, mo7: 0.25, mo30: 0.15 },
  5: { size: 0.2, liq: 0.35, mo7: 0.3, mo30: 0.15 }
};

interface RiskLevelQueryOptions {
  /** Drop the MIN_MARKET_CAP floor (first and only relaxed fallback) */
  dropMcapFloor?: boolean;
}

/**
 * EXISTS sub-query asserting an active exchange_symbol_map row on at least one
 * of the user's connected exchanges with a recent non-zero-volume OHLC candle.
 */
export const TRADABLE_ON_USER_EXCHANGES_SQL = `EXISTS (
          SELECT 1 FROM exchange_symbol_map esm
          WHERE esm."coinId" = coin.id
            AND esm."isActive" = true
            AND esm."exchangeId" IN (:...userExchangeIds)
            AND EXISTS (
              SELECT 1 FROM ohlc_candles oc
              WHERE oc."coinId" = coin.id
                AND oc."exchangeId" = esm."exchangeId"
                AND oc.timestamp > NOW() - (:freshnessHours || ' hours')::interval
                AND oc.volume > 0
            )
        )`;

/**
 * EXISTS sub-query asserting an active exchange_symbol_map row on any exchange
 * with a recent non-zero-volume OHLC candle. Used in preview flows where the
 * caller has not constrained the candidate pool to specific user exchanges.
 */
const TRADABLE_ON_ANY_EXCHANGE_SQL = `EXISTS (
          SELECT 1 FROM exchange_symbol_map esm
          WHERE esm."coinId" = coin.id
            AND esm."isActive" = true
            AND EXISTS (
              SELECT 1 FROM ohlc_candles oc
              WHERE oc."coinId" = coin.id
                AND oc."exchangeId" = esm."exchangeId"
                AND oc.timestamp > NOW() - (:freshnessHours || ' hours')::interval
                AND oc.volume > 0
            )
        )`;

function buildRiskLevelScoreSql(level: number): string {
  // level is clamped to 1–5 before this call, so interpolation is safe
  const weights = RISK_LEVEL_WEIGHTS[level];

  const terms: string[] = [
    `COALESCE(LN(coin."marketCap" + 1), 0) * ${weights.size}`,
    `COALESCE(LN(coin."totalVolume" + 1), 0) * ${weights.liq}`
  ];
  if (weights.mo7 > 0) {
    terms.push(`COALESCE(coin."priceChangePercentage7d", 0) * ${weights.mo7}`);
  }
  if (weights.mo30 > 0) {
    terms.push(`COALESCE(coin."priceChangePercentage30d", 0) * ${weights.mo30}`);
  }

  // Sentiment nudge centred at 50 → range [-1, +1] scaled by SENTIMENT_WEIGHT
  const sentimentBonus = `((COALESCE(coin."sentimentUp", 50) - 50) / 50.0 * ${SENTIMENT_WEIGHT})`;
  return `(${terms.join(' + ')}) + ${sentimentBonus}`;
}

function applyTradableEligibility(qb: SelectQueryBuilder<Coin>, userExchangeIds: string[] | undefined): void {
  if (userExchangeIds && userExchangeIds.length > 0) {
    qb.andWhere(TRADABLE_ON_USER_EXCHANGES_SQL, {
      userExchangeIds,
      freshnessHours: MIN_OHLC_FRESHNESS_HOURS
    });
  } else {
    qb.andWhere(TRADABLE_ON_ANY_EXCHANGE_SQL, { freshnessHours: MIN_OHLC_FRESHNESS_HOURS });
  }
}

async function queryCoinsByRiskLevel(
  repo: Repository<Coin>,
  level: number,
  take: number,
  userExchangeIds: string[] | undefined,
  options: RiskLevelQueryOptions
): Promise<Coin[]> {
  const qb = repo
    .createQueryBuilder('coin')
    .where('coin.delistedAt IS NULL')
    .andWhere('coin.currentPrice IS NOT NULL')
    .andWhere('coin.totalVolume >= :minVolume', { minVolume: MIN_DAILY_VOLUME })
    .andWhere('UPPER(coin.symbol) NOT IN (:...stablecoins)', {
      stablecoins: Array.from(STABLECOIN_SYMBOLS)
    });

  if (options.dropMcapFloor) {
    qb.andWhere('coin.marketCap IS NOT NULL');
  } else {
    qb.andWhere('coin.marketCap >= :minMarketCap', { minMarketCap: MIN_MARKET_CAP });
  }

  if (level === 5) {
    qb.andWhere('coin.marketCap BETWEEN :l5Min AND :l5Max', {
      l5Min: LEVEL_5_MIN_MARKET_CAP,
      l5Max: LEVEL_5_MAX_MARKET_CAP
    });
  }

  applyTradableEligibility(qb, userExchangeIds);

  qb.orderBy(buildRiskLevelScoreSql(level), 'DESC').addOrderBy('coin.marketRank', 'ASC', 'NULLS LAST').take(take);

  return qb.getMany();
}

/**
 * Preview coins for a specific risk level (1-5). Oversamples the ranked
 * candidate pool (by `SHORTLIST_MULTIPLIER`), then hands it to the diversity
 * service to veto near-duplicate coins before returning the final `take`.
 *
 * Two fallback tiers: strict (marketCap ≥ 100M) → relaxed (marketCap not null).
 * Pruning only runs when the shortlist is at least `2 * take` — anything
 * smaller is too thin to meaningfully diversify, so we fall through to the
 * next tier to hopefully widen the pool first.
 */
export async function selectCoinsByRiskLevel(
  repo: Repository<Coin>,
  diversityService: CoinDiversityService | undefined,
  level: number,
  take: number,
  userExchangeIds?: string[]
): Promise<Coin[]> {
  const riskLevel = Math.max(1, Math.min(5, Math.floor(Number(level) || 3)));
  const shortlistSize = take * SHORTLIST_MULTIPLIER;

  const fallbackOptions: RiskLevelQueryOptions[] = [{}, { dropMcapFloor: true }];

  let lastResult: Coin[] = [];
  for (const options of fallbackOptions) {
    const coins = await queryCoinsByRiskLevel(repo, riskLevel, shortlistSize, userExchangeIds, options);
    if (coins.length >= take * 2) {
      return diversityService ? diversityService.pruneByDiversity(coins, take) : coins.slice(0, take);
    }
    if (coins.length > lastResult.length) lastResult = coins;
  }

  if (lastResult.length >= take) {
    return diversityService ? diversityService.pruneByDiversity(lastResult, take) : lastResult.slice(0, take);
  }
  return lastResult;
}
