import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { DefiLlamaClientService } from './defi-llama-client.service';

import { Coin } from '../../coin/coin.entity';
import { TickerPairs } from '../../coin/ticker-pairs/ticker-pairs.entity';
import { toErrorInfo } from '../../shared/error.util';
import { ListingCandidate, ListingScoreBreakdown } from '../entities/listing-candidate.entity';

type ScoreWeights = {
  tvlGrowth90d: number;
  crossListingCount: number;
  categoryMomentum: number;
  socialVelocity: number;
  marketCapRank: number;
};

const DEFAULT_WEIGHTS: ScoreWeights = {
  tvlGrowth90d: 0.3,
  crossListingCount: 0.25,
  categoryMomentum: 0.2,
  socialVelocity: 0.15,
  marketCapRank: 0.1
};

const KRAKEN_MULTIPLIER = 1.5;
const DEFAULT_THRESHOLD = 70;

/** Exchanges excluded from cross-listing scoring — candidates must NOT appear on these */
const MAJOR_EXCHANGES = new Set(['binance', 'binance_us', 'coinbase', 'gdax']);

/** Exchanges counted toward the cross-listing score */
const TARGET_EXCHANGES = new Set(['kucoin', 'gate', 'gateio', 'okx', 'kraken']);

export interface ScoreCoinResult {
  coinId: string;
  symbol: string;
  score: number;
  qualified: boolean;
  breakdown: ListingScoreBreakdown;
}

@Injectable()
export class CrossListingScorerService {
  private readonly logger = new Logger(CrossListingScorerService.name);
  private readonly scoreThreshold: number;

  constructor(
    @InjectRepository(Coin) private readonly coinRepo: Repository<Coin>,
    @InjectRepository(TickerPairs) private readonly tickerRepo: Repository<TickerPairs>,
    @InjectRepository(ListingCandidate) private readonly candidateRepo: Repository<ListingCandidate>,
    private readonly defiLlama: DefiLlamaClientService,
    configService?: ConfigService
  ) {
    const rawThreshold = configService?.get<string | number>('LISTING_SCORE_THRESHOLD');
    const parsed = typeof rawThreshold === 'string' ? parseFloat(rawThreshold) : rawThreshold;
    this.scoreThreshold =
      typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_THRESHOLD;
  }

  /**
   * Score every non-delisted coin and persist `ListingCandidate` rows.
   *
   * Returns the list of qualified candidates (score ≥ threshold).
   */
  async scoreAll(): Promise<ScoreCoinResult[]> {
    const coins = await this.coinRepo
      .createQueryBuilder('coin')
      .where('coin.delistedAt IS NULL')
      .andWhere('coin.marketRank IS NOT NULL')
      .getMany();

    const slugsByCoin = await this.fetchExchangeSlugsByCoin(coins.map((c) => c.id));

    const results: ScoreCoinResult[] = [];
    for (const coin of coins) {
      try {
        const result = await this.scoreCoin(coin, slugsByCoin.get(coin.id) ?? new Set<string>());
        if (!result) continue;
        results.push(result);
        await this.upsertCandidate(result);
      } catch (error) {
        const err = toErrorInfo(error);
        this.logger.warn(`Failed to score ${coin.symbol}: ${err.message}`);
      }
    }
    return results.filter((r) => r.qualified);
  }

  /** Score a single coin. Returns null when the coin is on a major exchange (ineligible). */
  async scoreCoin(coin: Coin, precomputedSlugs?: Set<string>): Promise<ScoreCoinResult | null> {
    const slugs =
      precomputedSlugs ??
      new Set(
        (
          await this.tickerRepo.find({
            where: { baseAsset: { id: coin.id } },
            relations: ['exchange']
          })
        )
          .map((p) => p.exchange?.slug)
          .filter((s): s is string => Boolean(s))
      );

    // Must NOT appear on any major exchange
    for (const major of MAJOR_EXCHANGES) {
      if (slugs.has(major)) return null;
    }

    const targetsPresent = [...TARGET_EXCHANGES].filter((slug) => slugs.has(slug));
    // Need at least 3 cross-listings on smaller exchanges
    if (targetsPresent.length < 3) return null;
    const krakenListed = slugs.has('kraken');

    const tvlGrowthPctRaw = (await this.defiLlama.getTvlGrowthPercent(coin.symbol)) ?? 0;
    const socialRaw = this.socialFromCoinGecko(coin);
    const socialAvailable = socialRaw !== null;

    // Normalize each component to [0, 100]
    const tvlGrowth = this.clamp(((tvlGrowthPctRaw + 50) / 150) * 100, 0, 100); // maps -50% → 0, +100% → 100
    const crossListingBase = Math.min(100, (targetsPresent.length / 5) * 100);
    const crossListingCount = krakenListed ? Math.min(100, crossListingBase * KRAKEN_MULTIPLIER) : crossListingBase;
    const categoryMomentum = this.estimateCategoryMomentum(coin);
    const socialVelocity = socialRaw ?? 0;
    const marketCapRank = this.scoreMarketCapRank(coin.marketRank ?? null);

    const weights = socialAvailable ? DEFAULT_WEIGHTS : this.redistributeSocialWeight();

    const score =
      weights.tvlGrowth90d * tvlGrowth +
      weights.crossListingCount * crossListingCount +
      weights.categoryMomentum * categoryMomentum +
      weights.socialVelocity * socialVelocity +
      weights.marketCapRank * marketCapRank;

    const finalScore = Math.round(score * 100) / 100;
    const qualified = finalScore >= this.scoreThreshold;

    const breakdown: ListingScoreBreakdown = {
      tvlGrowth90d: tvlGrowth,
      crossListingCount,
      categoryMomentum,
      socialVelocity,
      marketCapRank,
      krakenListed,
      socialDataAvailable: socialAvailable,
      weights,
      raw: {
        tvlGrowthPctRaw,
        targetsPresent,
        socialComponents: {
          sentimentUp: coin.sentimentUp ?? null
        },
        marketRank: coin.marketRank ?? null
      }
    };

    return { coinId: coin.id, symbol: coin.symbol, score: finalScore, qualified, breakdown };
  }

  /** Sweet-spot market-cap ranking — rank 50-300 gets 100, outside decays linearly */
  private scoreMarketCapRank(rank: number | null): number {
    if (rank == null) return 20;
    if (rank < 50) return Math.max(40, 100 - (50 - rank) * 1.2);
    if (rank <= 300) return 100;
    if (rank <= 1000) return Math.max(10, 100 - (rank - 300) * 0.128);
    return 0;
  }

  /** Simplified category momentum heuristic using the coin's 7d price change */
  private estimateCategoryMomentum(coin: Coin): number {
    const change7d = coin.priceChangePercentage7d ?? 0;
    // Map -20% → 0, +20% → 100
    return this.clamp(((change7d + 20) / 40) * 100, 0, 100);
  }

  /**
   * Social signal from the one CoinGecko field still populated on the free tier.
   * Returns null when sentiment is missing so the caller can redistribute weight.
   */
  private socialFromCoinGecko(coin: Coin): number | null {
    return coin.sentimentUp ?? null;
  }

  private redistributeSocialWeight(): ScoreWeights {
    const remaining = 1 - DEFAULT_WEIGHTS.socialVelocity;
    return {
      tvlGrowth90d: DEFAULT_WEIGHTS.tvlGrowth90d / remaining,
      crossListingCount: DEFAULT_WEIGHTS.crossListingCount / remaining,
      categoryMomentum: DEFAULT_WEIGHTS.categoryMomentum / remaining,
      socialVelocity: 0,
      marketCapRank: DEFAULT_WEIGHTS.marketCapRank / remaining
    };
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private async fetchExchangeSlugsByCoin(coinIds: string[]): Promise<Map<string, Set<string>>> {
    if (coinIds.length === 0) return new Map();
    const rows = await this.tickerRepo
      .createQueryBuilder('ticker')
      .leftJoin('ticker.exchange', 'exchange')
      .select('ticker.baseAssetId', 'coinId')
      .addSelect('exchange.slug', 'slug')
      .where('ticker.baseAssetId IN (:...coinIds)', { coinIds })
      .getRawMany<{ coinId: string; slug: string | null }>();

    const result = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!row.coinId || !row.slug) continue;
      let set = result.get(row.coinId);
      if (!set) {
        set = new Set();
        result.set(row.coinId, set);
      }
      set.add(row.slug);
    }
    return result;
  }

  private async upsertCandidate(result: ScoreCoinResult): Promise<void> {
    const now = new Date();
    const existing = await this.candidateRepo.findOne({ where: { coinId: result.coinId } });
    if (existing) {
      existing.score = result.score;
      existing.scoreBreakdown = result.breakdown;
      existing.qualified = result.qualified;
      existing.lastScoredAt = now;
      await this.candidateRepo.save(existing);
      return;
    }
    const candidate = this.candidateRepo.create({
      coinId: result.coinId,
      score: result.score,
      scoreBreakdown: result.breakdown,
      qualified: result.qualified,
      firstScoredAt: now,
      lastScoredAt: now
    });
    await this.candidateRepo.save(candidate);
  }

  get threshold(): number {
    return this.scoreThreshold;
  }
}
