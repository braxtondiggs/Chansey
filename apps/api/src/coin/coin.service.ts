import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { FindOptionsWhere, In, IsNull, Not, QueryDeepPartialEntity, Repository } from 'typeorm';

import { CoinDailySnapshotService } from './coin-daily-snapshot.service';
import { CoinDiversityService, SHORTLIST_MULTIPLIER } from './coin-diversity.service';
import { MIN_DAILY_VOLUME, MIN_MARKET_CAP } from './coin-quality.constants';
import { Coin, CoinRelations } from './coin.entity';
import { CreateCoinDto, UpdateCoinDto } from './dto/';

import { CoinNotFoundException } from '../common/exceptions/resource';
import { STABLECOIN_SYMBOLS } from '../exchange/constants';
import { User } from '../users/users.entity';
import { stripNullProps } from '../utils/strip-null-props.util';

/** Weight applied to the sentiment nudge when blending with the primary score. */
const SENTIMENT_WEIGHT = 0.1;
/** Level-5 mid-cap band: excludes mega-caps and dust. */
const LEVEL_5_MIN_MARKET_CAP = 50_000_000;
const LEVEL_5_MAX_MARKET_CAP = 5_000_000_000;

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

@Injectable()
export class CoinService {
  private readonly logger = new Logger(CoinService.name);

  static isVirtualCoin(coin: Coin): boolean {
    return coin.id?.includes('virtual') ?? false;
  }

  private static createVirtualUsdCoin(): Coin {
    return new Coin({
      id: 'USD-virtual',
      slug: 'usd',
      name: 'US Dollar',
      symbol: 'USD',
      image: 'https://flagcdn.com/w80/us.png',
      description:
        'The United States dollar is the official currency of the United States and several other countries.',
      totalSupply: undefined,
      circulatingSupply: undefined,
      maxSupply: undefined,
      marketCap: undefined,
      priceChangePercentage24h: undefined
    });
  }

  constructor(
    @InjectRepository(Coin) private readonly coin: Repository<Coin>,
    private readonly snapshotService: CoinDailySnapshotService,
    // Optional: several modules shadow-register CoinService locally (users, order,
    // algorithm, exchange) without importing CoinModule. Those instances run
    // without a diversity service — safe because none of them call risk-level
    // selection (only CoinModule's authoritative instance does).
    @Optional() private readonly diversityService?: CoinDiversityService
  ) {}

  async getCoins(options?: { includeDelisted?: boolean }) {
    const where: FindOptionsWhere<Coin> = {};
    if (!options?.includeDelisted) {
      where.delistedAt = IsNull();
    }
    const coins = await this.coin.find({ where, order: { marketRank: 'ASC' } });
    return coins.map((coin) => stripNullProps(coin));
  }

  async getCoinById(coinId: string, relations?: CoinRelations[]): Promise<Coin> {
    const coin = await this.coin.findOne({ where: { id: coinId }, relations });
    if (!coin) throw new CoinNotFoundException(coinId);
    stripNullProps(coin);
    return coin;
  }

  /**
   * Get multiple coins by their IDs
   * @param coinIds - Array of coin IDs to fetch (duplicates are automatically removed)
   * @param relations - Optional relations to include
   * @returns Array of coins found (may be fewer than requested if some IDs don't exist)
   */
  async getCoinsByIds(coinIds: string[], relations?: CoinRelations[]): Promise<Coin[]> {
    if (coinIds.length === 0) return [];

    // Deduplicate and filter out empty/invalid IDs
    const uniqueIds = [...new Set(coinIds.filter((id) => id && typeof id === 'string' && id.trim().length > 0))];
    if (uniqueIds.length === 0) return [];

    const coins = await this.coin.find({
      where: { id: In(uniqueIds) },
      relations
    });
    return coins.map((coin) => {
      stripNullProps(coin);
      return coin;
    });
  }

  /**
   * Get coins by IDs filtered by minimum market cap and daily volume.
   * Returns coins sorted by market cap DESC so higher-quality coins come first.
   * Used by the backtest default dataset to exclude low-quality/meme coins.
   */
  async getCoinsByIdsFiltered(
    coinIds: string[],
    minMarketCap = MIN_MARKET_CAP,
    minDailyVolume = MIN_DAILY_VOLUME,
    options?: { includeDelisted?: boolean; skipCurrentPriceCheck?: boolean }
  ): Promise<Coin[]> {
    if (coinIds.length === 0) return [];

    const uniqueIds = [...new Set(coinIds.filter((id) => id && typeof id === 'string' && id.trim().length > 0))];
    if (uniqueIds.length === 0) return [];

    const qb = this.coin
      .createQueryBuilder('coin')
      .where('coin.id IN (:...ids)', { ids: uniqueIds })
      .andWhere('coin.marketCap >= :minMarketCap', { minMarketCap })
      .andWhere('coin.totalVolume >= :minDailyVolume', { minDailyVolume });

    if (!options?.skipCurrentPriceCheck) {
      qb.andWhere('coin.currentPrice IS NOT NULL');
    }

    if (!options?.includeDelisted) {
      qb.andWhere('coin.delistedAt IS NULL');
    }

    return qb.orderBy('coin.marketCap', 'DESC').getMany();
  }

  /**
   * Date-aware quality filter: returns coins that met market cap/volume thresholds
   * at the specified historical date, using daily snapshot data.
   * Falls back to current values if no snapshots exist near the date.
   */
  async getCoinsByIdsFilteredAtDate(
    coinIds: string[],
    atDate: Date,
    minMarketCap = MIN_MARKET_CAP,
    minDailyVolume = MIN_DAILY_VOLUME
  ): Promise<{ coins: Coin[]; usedHistoricalData: boolean }> {
    if (coinIds.length === 0) return { coins: [], usedHistoricalData: false };

    const dateStr = atDate.toISOString().split('T')[0];

    // Try historical snapshots first
    const { qualifiedIds, hasSnapshots } = await this.snapshotService.getQualifiedCoinIdsAtDate(
      coinIds,
      atDate,
      minMarketCap,
      minDailyVolume
    );

    if (qualifiedIds.length > 0) {
      // Fetch full Coin entities and preserve historical market cap order
      const coins = await this.coin.find({ where: { id: In(qualifiedIds) } });
      const coinsById = new Map(coins.map((coin) => [coin.id, coin] as const));
      const sorted = qualifiedIds.map((id) => coinsById.get(id)).filter(Boolean) as Coin[];
      return { coins: sorted, usedHistoricalData: true };
    }

    if (hasSnapshots) {
      // Snapshots exist but no coins met quality thresholds — return empty to preserve historical accuracy
      this.logger.warn(
        `Historical snapshots exist at ${dateStr} but no coins met quality thresholds — returning empty to preserve historical accuracy`
      );
      return { coins: [], usedHistoricalData: true };
    }

    // No snapshot data at all — fall back to current market data.
    // Skip the currentPrice check: this path is only reached from backtest contexts where
    // tradeability is already confirmed via OHLC candle data, and a stale/null currentPrice
    // on the coin row should not exclude an otherwise qualifying coin.
    this.logger.warn(`No snapshot data exists near ${dateStr} — falling back to current market data`);
    const coins = await this.getCoinsByIdsFiltered(coinIds, minMarketCap, minDailyVolume, {
      includeDelisted: true,
      skipCurrentPriceCheck: true
    });
    return { coins, usedHistoricalData: false };
  }

  async getCoinBySymbol(
    symbol: string,
    relations?: CoinRelations[],
    fail?: true,
    includeDelisted?: boolean
  ): Promise<Coin>;
  async getCoinBySymbol(
    symbol: string,
    relations: CoinRelations[] | undefined,
    fail: false,
    includeDelisted?: boolean
  ): Promise<Coin | null>;
  async getCoinBySymbol(
    symbol: string,
    relations?: CoinRelations[],
    fail = true,
    includeDelisted = false
  ): Promise<Coin | null> {
    // Handle USD as a special case
    if (symbol.toLowerCase() === 'usd') {
      return CoinService.createVirtualUsdCoin();
    }

    // Handle other coins normally
    const where: FindOptionsWhere<Coin> = { symbol: symbol.toLowerCase() };
    if (!includeDelisted) {
      where.delistedAt = IsNull();
    }
    const coin = await this.coin.findOne({ where, relations });
    if (!coin && fail) throw new CoinNotFoundException(symbol, 'symbol');
    if (coin) {
      stripNullProps(coin);
    }
    return coin;
  }

  /**
   * Get multiple coins by their symbols
   * @param symbols Array of coin symbols to retrieve
   * @param relations Optional coin relations to include
   * @returns Array of coin entities that were found matching the provided symbols.
   * If some symbols don't exist, they're silently ignored (with a warning log).
   */
  async getMultipleCoinsBySymbol(
    symbols: string[],
    relations?: CoinRelations[],
    options?: { includeDelisted?: boolean }
  ): Promise<Coin[]> {
    // Convert all symbols to lowercase for case-insensitive comparison
    const lowercaseSymbols = symbols.map((symbol) => symbol.toLowerCase());

    // Check if USD is requested
    const usdIndex = lowercaseSymbols.indexOf('usd');
    const needsUsd = usdIndex !== -1;

    // Remove USD from the search if it's included as it's a special case
    const symbolsToSearch = needsUsd ? lowercaseSymbols.filter((symbol) => symbol !== 'usd') : lowercaseSymbols;

    // Only query the database if we have actual coin symbols to search for
    const whereClause: FindOptionsWhere<Coin> = { symbol: In(symbolsToSearch) };
    if (!options?.includeDelisted) {
      whereClause.delistedAt = IsNull();
    }
    const coins =
      symbolsToSearch.length > 0
        ? await this.coin.find({
            where: whereClause,
            relations,
            order: { name: 'ASC' }
          })
        : [];

    // Create a virtual USD coin when requested
    if (needsUsd) {
      coins.push(CoinService.createVirtualUsdCoin());
    }

    // No need to throw error for missing symbols, just return what we found
    // For logging purposes, we can still detect missing symbols
    const foundSymbols = coins.map((coin) => coin.symbol.toLowerCase());
    const missingSymbols = lowercaseSymbols.filter(
      (symbol) => !foundSymbols.includes(symbol) && symbol !== 'usd' // Don't log USD as missing since we handle it specially
    );

    if (missingSymbols.length > 0) {
      this.logger.warn(`Some requested coin symbols were not found: ${missingSymbols.join(', ')}`);
    }

    // Clean null values from all coins
    return coins.map((coin) => {
      stripNullProps(coin);
      return coin;
    });
  }

  async create(dto: CreateCoinDto): Promise<void> {
    const existing = await this.coin.findOne({ where: { slug: dto.slug } });
    if (!existing) {
      await this.coin.insert(dto as QueryDeepPartialEntity<Coin>);
    }
  }

  async createMany(coins: CreateCoinDto[]): Promise<void> {
    const existingCoins = await this.coin.find({
      where: coins.map((coin) => ({ slug: coin.slug }))
    });

    const newCoins = coins.filter((coin) => !existingCoins.find((existing) => existing.slug === coin.slug));

    if (newCoins.length === 0) return;

    await this.coin.insert(newCoins as QueryDeepPartialEntity<Coin>[]);
  }

  async update(coinId: string, coin: UpdateCoinDto) {
    const data = await this.getCoinById(coinId);
    return await this.coin.save(new Coin({ ...data, ...coin }) as QueryDeepPartialEntity<Coin> & Coin);
  }

  async updateCurrentPrice(coinId: string, price: number): Promise<void> {
    await this.coin.update(coinId, { currentPrice: price });
  }

  async markSnapshotBackfillComplete(coinId: string): Promise<void> {
    await this.coin.update(coinId, { snapshotBackfillCompletedAt: new Date() });
  }

  async clearRank() {
    await this.coin.createQueryBuilder().update().set({ geckoRank: null }).execute();
  }

  async remove(coinId: string) {
    const coin = await this.getCoinById(coinId);
    if (coin.delistedAt) return coin;
    coin.delistedAt = new Date();
    return this.coin.save(coin);
  }

  async removeMany(coinIds: string[]): Promise<void> {
    if (coinIds.length === 0) return;
    await this.coin
      .createQueryBuilder()
      .update()
      .set({ delistedAt: new Date() })
      .where('id IN (:...ids)', { ids: coinIds })
      .andWhere('delistedAt IS NULL')
      .execute();
  }

  async hardRemoveMany(coinIds: string[]): Promise<void> {
    if (coinIds.length === 0) return;
    await this.coin.delete({ id: In(coinIds) });
  }

  async relistCoin(coinId: string): Promise<void> {
    await this.coin.update(coinId, { delistedAt: null });
  }

  async relistMany(coinIds: string[]): Promise<void> {
    if (coinIds.length === 0) return;
    await this.coin
      .createQueryBuilder()
      .update()
      .set({ delistedAt: null })
      .where('id IN (:...ids)', { ids: coinIds })
      .andWhere('delistedAt IS NOT NULL')
      .execute();
  }

  async getDelistedCoins(): Promise<Coin[]> {
    return this.coin.find({ where: { delistedAt: Not(IsNull()) } });
  }

  async getCoinsWithCurrentPrices() {
    const coins = await this.coin.find({
      select: ['id', 'slug', 'name', 'symbol', 'image', 'currentPrice'],
      where: { delistedAt: IsNull() },
      order: { name: 'ASC' }
    });
    return coins.map((coin) => stripNullProps(coin));
  }

  async getCoinBySlug(slug: string) {
    return this.coin.findOne({ where: { slug } });
  }

  /**
   * Look up non-delisted coins whose symbol (case-insensitive) is in the input set.
   * Used by the symbol-map seeder to intersect US-exchange base symbols with our
   * coin universe and prioritise them by market rank.
   */
  async getCoinsBySymbols(symbols: Set<string>): Promise<Coin[]> {
    if (symbols.size === 0) return [];
    const normalized = Array.from(symbols, (s) => s.toLowerCase());
    return this.coin
      .createQueryBuilder('coin')
      .where('LOWER(coin.symbol) IN (:...symbols)', { symbols: normalized })
      .andWhere('coin.delistedAt IS NULL')
      .orderBy('coin.marketRank', 'ASC', 'NULLS LAST')
      .getMany();
  }

  /**
   * Get risk-based coin selection for a user. Optionally constrains the candidate
   * pool to coins tradeable on the user's connected exchanges (`userExchangeIds`).
   * Falls through to the generic "any active mapping" filter when no exchange IDs
   * are provided (preview flows).
   */
  async getCoinsByRiskLevel({ coinRisk }: User, take = 10, userExchangeIds?: string[]) {
    const riskLevel = Math.max(1, Math.min(5, Math.floor(Number(coinRisk?.level) || 3)));
    return this.getCoinsByRiskLevelValue(riskLevel, take, userExchangeIds);
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
  async getCoinsByRiskLevelValue(level: number, take = 10, userExchangeIds?: string[]): Promise<Coin[]> {
    const riskLevel = Math.max(1, Math.min(5, Math.floor(Number(level) || 3)));
    const shortlistSize = take * SHORTLIST_MULTIPLIER;

    const fallbackOptions: RiskLevelQueryOptions[] = [{}, { dropMcapFloor: true }];

    let lastResult: Coin[] = [];
    for (const options of fallbackOptions) {
      const coins = await this.queryCoinsByRiskLevel(riskLevel, shortlistSize, userExchangeIds, options);
      if (coins.length >= take * 2) {
        return this.diversityService ? this.diversityService.pruneByDiversity(coins, take) : coins.slice(0, take);
      }
      if (coins.length > lastResult.length) lastResult = coins;
    }

    if (lastResult.length >= take) {
      return this.diversityService
        ? this.diversityService.pruneByDiversity(lastResult, take)
        : lastResult.slice(0, take);
    }
    return lastResult;
  }

  private async queryCoinsByRiskLevel(
    level: number,
    take: number,
    userExchangeIds: string[] | undefined,
    options: RiskLevelQueryOptions
  ): Promise<Coin[]> {
    const qb = this.coin
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

    if (userExchangeIds && userExchangeIds.length > 0) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM exchange_symbol_map esm
          WHERE esm."coinId" = coin.id
            AND esm."isActive" = true
            AND esm."exchangeId" IN (:...userExchangeIds)
        )`,
        { userExchangeIds }
      );
    } else {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM exchange_symbol_map esm
          WHERE esm."coinId" = coin.id
            AND esm."isActive" = true
        )`
      );
    }

    qb.orderBy(this.buildRiskLevelScoreSql(level), 'DESC')
      .addOrderBy('coin.marketRank', 'ASC', 'NULLS LAST')
      .take(take);

    return qb.getMany();
  }

  private buildRiskLevelScoreSql(level: number): string {
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

  /**
   * Get popular coins for backtesting based on market cap and trading volume
   * @param limit Number of coins to return (default: 20)
   * @returns Array of popular coins suitable for backtesting
   */
  async getPopularCoins(limit = 20): Promise<Coin[]> {
    return await this.coin.find({
      where: {
        marketCap: Not(IsNull()),
        totalVolume: Not(IsNull()),
        currentPrice: Not(IsNull()),
        delistedAt: IsNull()
      },
      order: {
        marketCap: 'DESC'
      },
      take: limit
    });
  }
}
