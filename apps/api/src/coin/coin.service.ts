import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { FindOptionsWhere, In, IsNull, Not, QueryDeepPartialEntity, Repository } from 'typeorm';

import { CoinDailySnapshotService } from './coin-daily-snapshot.service';
import { CoinDiversityService } from './coin-diversity.service';
import { MIN_DAILY_VOLUME, MIN_MARKET_CAP } from './coin-quality.constants';
import {
  MIN_OHLC_FRESHNESS_HOURS,
  TRADABLE_ON_USER_EXCHANGES_SQL,
  selectCoinsByRiskLevel
} from './coin-risk-selection';
import { Coin, CoinRelations } from './coin.entity';
import { CreateCoinDto, UpdateCoinDto } from './dto/';

import { CoinNotFoundException } from '../common/exceptions/resource';
import { STABLECOIN_SYMBOLS } from '../exchange/constants';
import { User } from '../users/users.entity';
import { stripNullProps } from '../utils/strip-null-props.util';

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
   * Eligibility predicate for symbol-map seeding. Mirrors the hard filter used by
   * risk-level selection in `queryCoinsByRiskLevel`: only coins that could ever be
   * picked by the selection engine deserve an OHLC mapping. Without this filter
   * the seeder creates ghost mappings for low-cap or delisted coins whose Kraken
   * pair exists in the markets endpoint but has no fetchable history, generating
   * recurring "Backfill produced 0 candles" warnings.
   *
   * When `baseSymbols` is provided, results are intersected (case-insensitive)
   * with that set so the seeder can scope to symbols listed on its priority
   * exchanges.
   */
  async getEligibleCoinsForMapping(baseSymbols?: Set<string>, take?: number): Promise<Coin[]> {
    if (baseSymbols !== undefined && baseSymbols.size === 0) return [];

    const qb = this.coin
      .createQueryBuilder('coin')
      .where('coin.delistedAt IS NULL')
      .andWhere('coin.currentPrice IS NOT NULL')
      .andWhere('coin.marketCap >= :minMarketCap', { minMarketCap: MIN_MARKET_CAP })
      .andWhere('coin.totalVolume >= :minDailyVolume', { minDailyVolume: MIN_DAILY_VOLUME })
      .andWhere('UPPER(coin.symbol) NOT IN (:...stablecoins)', {
        stablecoins: Array.from(STABLECOIN_SYMBOLS)
      });

    if (baseSymbols !== undefined) {
      const normalized = Array.from(baseSymbols, (s) => s.toLowerCase());
      qb.andWhere('LOWER(coin.symbol) IN (:...symbols)', { symbols: normalized });
    }

    qb.orderBy('coin.marketRank', 'ASC', 'NULLS LAST');
    if (take !== undefined) qb.take(take);
    return qb.getMany();
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
   * candidate pool, then hands it to the diversity service to veto
   * near-duplicate coins before returning the final `take`.
   */
  async getCoinsByRiskLevelValue(level: number, take = 10, userExchangeIds?: string[]): Promise<Coin[]> {
    return selectCoinsByRiskLevel(this.coin, this.diversityService, level, take, userExchangeIds);
  }

  /**
   * Tradability check used by the coin-selection add-path: returns true if the
   * coin has an active `exchange_symbol_map` row AND recent non-zero-volume
   * OHLC candles for at least one of the user's connected exchanges. Mirrors
   * the EXISTS filter used in risk-level selection so a manual add can't
   * bypass the same eligibility guard the auto-selector applies.
   *
   * Returns false (not throws) when `userExchangeIds` is empty so the caller
   * can decide how to phrase the error.
   */
  async isCoinTradableOnUserExchanges(coinId: string, userExchangeIds: string[]): Promise<boolean> {
    if (userExchangeIds.length === 0) return false;

    const result = await this.coin
      .createQueryBuilder('coin')
      .select('coin.id')
      .where('coin.id = :coinId', { coinId })
      .andWhere(TRADABLE_ON_USER_EXCHANGES_SQL, {
        userExchangeIds,
        freshnessHours: MIN_OHLC_FRESHNESS_HOURS
      })
      .getOne();

    return result !== null;
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
