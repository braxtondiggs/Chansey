import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { AxiosError } from 'axios';
import { Cache } from 'cache-manager';
import { CoinGeckoClient } from 'coingecko-api-v3';
import { In, IsNull, Not, QueryDeepPartialEntity, Repository } from 'typeorm';

import { CoinDetailResponseDto, MarketChartResponseDto, TimePeriod } from '@chansey/api-interfaces';

import { Coin, CoinRelations } from './coin.entity';
import { CreateCoinDto, UpdateCoinDto } from './dto/';

import { CoinNotFoundException } from '../common/exceptions/resource';
import { CircuitBreakerService, CircuitOpenError } from '../shared';
import { User } from '../users/users.entity';
import { stripHtml } from '../utils/strip-html.util';
import { stripNullProps } from '../utils/strip-null-props.util';

interface HistoricalDataPoint {
  timestamp: number;
  price: number;
  volume: number;
  marketCap?: number;
}

interface CoinGeckoCoinDetail {
  description?: {
    en?: string;
  };
  links?: {
    homepage?: string[];
    blockchain_site?: string[];
    official_forum_url?: string[];
    subreddit_url?: string | null;
    repos_url?: {
      github?: string[];
    };
  };
}

interface CoinGeckoMarketChart {
  prices: [number, number][];
  market_caps?: [number, number][];
  total_volumes?: [number, number][];
}

@Injectable()
export class CoinService {
  private readonly gecko = new CoinGeckoClient({ timeout: 10000, autoRetry: true });
  private readonly logger = new Logger(CoinService.name);

  private static readonly CIRCUIT_KEY = 'coingecko-chart';

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
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly circuitBreaker: CircuitBreakerService
  ) {
    this.circuitBreaker.configure(CoinService.CIRCUIT_KEY, {
      failureThreshold: 3,
      resetTimeoutMs: 60000
    });
  }

  async getCoins() {
    const coins = await this.coin.find({ order: { marketRank: 'ASC' } });
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
    minMarketCap = 100_000_000,
    minDailyVolume = 1_000_000
  ): Promise<Coin[]> {
    if (coinIds.length === 0) return [];

    const uniqueIds = [...new Set(coinIds.filter((id) => id && typeof id === 'string' && id.trim().length > 0))];
    if (uniqueIds.length === 0) return [];

    return this.coin
      .createQueryBuilder('coin')
      .where('coin.id IN (:...ids)', { ids: uniqueIds })
      .andWhere('coin.marketCap >= :minMarketCap', { minMarketCap })
      .andWhere('coin.totalVolume >= :minDailyVolume', { minDailyVolume })
      .andWhere('coin.currentPrice IS NOT NULL')
      .orderBy('coin.marketCap', 'DESC')
      .getMany();
  }

  async getCoinBySymbol(symbol: string, relations?: CoinRelations[], fail?: true): Promise<Coin>;
  async getCoinBySymbol(symbol: string, relations: CoinRelations[] | undefined, fail: false): Promise<Coin | null>;
  async getCoinBySymbol(symbol: string, relations?: CoinRelations[], fail = true): Promise<Coin | null> {
    // Handle USD as a special case
    if (symbol.toLowerCase() === 'usd') {
      return CoinService.createVirtualUsdCoin();
    }

    // Handle other coins normally
    const coin = await this.coin.findOne({
      where: { symbol: symbol.toLowerCase() },
      relations
    });
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
  async getMultipleCoinsBySymbol(symbols: string[], relations?: CoinRelations[]): Promise<Coin[]> {
    // Convert all symbols to lowercase for case-insensitive comparison
    const lowercaseSymbols = symbols.map((symbol) => symbol.toLowerCase());

    // Check if USD is requested
    const usdIndex = lowercaseSymbols.indexOf('usd');
    const needsUsd = usdIndex !== -1;

    // Remove USD from the search if it's included as it's a special case
    const symbolsToSearch = needsUsd ? lowercaseSymbols.filter((symbol) => symbol !== 'usd') : lowercaseSymbols;

    // Only query the database if we have actual coin symbols to search for
    const coins =
      symbolsToSearch.length > 0
        ? await this.coin.find({
            where: {
              symbol: In(symbolsToSearch)
            },
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

  async clearRank() {
    await this.coin.createQueryBuilder().update().set({ geckoRank: null }).execute();
  }

  async remove(coinId: string) {
    const response = await this.coin.delete(coinId);
    if (!response.affected) throw new CoinNotFoundException(coinId);
    return response;
  }

  async removeMany(coinIds: string[]): Promise<void> {
    await this.coin.delete({ id: In(coinIds) });
  }

  async getCoinHistoricalData(coinId: string): Promise<HistoricalDataPoint[]> {
    const coin = await this.getCoinById(coinId);

    try {
      const geckoData = await this.gecko.coinIdMarketChart({
        id: coin.slug,
        vs_currency: 'usd',
        days: 365, // !NOTE: Max value w/o paying money
        interval: 'daily'
      });

      if (geckoData?.prices && geckoData.prices.length > 0) {
        return geckoData.prices.map((point: number[], index: number) => ({
          timestamp: point[0],
          price: point[1],
          volume: (geckoData.total_volumes as number[][] | undefined)?.[index]?.[1] ?? 0,
          marketCap: (geckoData.market_caps as number[][] | undefined)?.[index]?.[1] ?? 0
        }));
      }

      return [];
    } catch (error: unknown) {
      if (error instanceof AxiosError && error.response?.status === 404) {
        throw new CoinNotFoundException(coinId);
      }
      this.logger.error(
        `Failed to fetch historical data for ${coinId}: ${error instanceof Error ? error.message : error}`
      );
      throw error;
    }
  }

  async getCoinsWithCurrentPrices() {
    const coins = await this.coin.find({
      select: ['id', 'slug', 'name', 'symbol', 'image', 'currentPrice'],
      order: { name: 'ASC' }
    });
    return coins.map((coin) => stripNullProps(coin));
  }

  async getCoinBySlug(slug: string) {
    return this.coin.findOne({ where: { slug } });
  }

  async getCoinsByRiskLevel({ coinRisk }: User, take = 10) {
    const riskLevel = Math.max(1, Math.min(5, Math.floor(Number(coinRisk?.level) || 3)));
    return this.getCoinsByRiskLevelValue(riskLevel, take);
  }

  /**
   * Preview coins for a specific risk level (1-5)
   * Used by the settings page to show users what coins will be selected
   */
  async getCoinsByRiskLevelValue(level: number, take = 10) {
    // Clamp to integer 1–5 to prevent SQL injection (value is interpolated in ORDER BY)
    const riskLevel = Math.max(1, Math.min(5, Math.floor(Number(level) || 3)));

    if (riskLevel === 1) {
      return await this.coin.find({
        where: {
          totalVolume: Not(IsNull())
        },
        order: {
          totalVolume: 'DESC'
        },
        take
      });
    }

    if (riskLevel === 5) {
      return await this.coin.find({
        where: {
          geckoRank: Not(IsNull())
        },
        order: {
          geckoRank: 'ASC'
        },
        take
      });
    }

    // For risk levels 2-4 — weights derived from clamped integer, safe by construction
    const volWeight = (5 - riskLevel) / 4;
    const capWeight = (5 - riskLevel) / 4;
    const rankWeight = (riskLevel - 1) / 4;

    return await this.coin
      .createQueryBuilder('coin')
      .where('coin.totalVolume IS NOT NULL')
      .andWhere('coin.geckoRank IS NOT NULL')
      .andWhere('coin.marketCap IS NOT NULL')
      .orderBy(
        `(
          COALESCE(LN(coin."totalVolume" + 1), 0) * ${volWeight} +
          COALESCE(LN(coin."marketCap" + 1), 0) * ${capWeight} -
          COALESCE(coin."geckoRank", 0) * ${rankWeight}
        )`,
        'DESC'
      )
      .take(take)
      .getMany();
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
        currentPrice: Not(IsNull())
      },
      order: {
        marketCap: 'DESC'
      },
      take: limit
    });
  }

  /**
   * T016/T036: Fetch coin detail from CoinGecko API with Redis caching
   * @param coinGeckoId CoinGecko coin identifier (e.g., 'bitcoin')
   * @returns CoinGecko coin detail data
   * @note Cached for 5 minutes to minimize API calls and handle rate limiting
   */
  private async fetchCoinDetail(coinGeckoId: string): Promise<CoinGeckoCoinDetail> {
    const cacheKey = `coingecko:detail:${coinGeckoId}`;
    const CACHE_TTL = 300; // 5 minutes in seconds

    try {
      // Try to get from cache first
      const cached = await this.cacheManager.get<CoinGeckoCoinDetail>(cacheKey);
      if (cached) {
        this.logger.debug(`CoinGecko detail cache HIT for ${coinGeckoId}`);
        return cached;
      }

      this.logger.debug(`CoinGecko detail cache MISS for ${coinGeckoId}, fetching from API`);

      // Fetch from API
      const coinDetail = (await this.gecko.coinId({
        id: coinGeckoId,
        localization: false,
        tickers: false,
        market_data: true,
        community_data: false,
        developer_data: false
      })) as CoinGeckoCoinDetail;

      // Cache the result
      await this.cacheManager.set(cacheKey, coinDetail, CACHE_TTL);
      this.logger.debug(`Cached CoinGecko detail for ${coinGeckoId} (TTL: ${CACHE_TTL}s)`);

      return coinDetail;
    } catch (error: unknown) {
      if (error instanceof AxiosError) {
        // Handle rate limiting (429) by trying to return cached data
        if (error.response?.status === 429) {
          this.logger.warn(`CoinGecko rate limit hit for ${coinGeckoId}, attempting to use cached data`);
          const cached = await this.cacheManager.get<CoinGeckoCoinDetail>(cacheKey);
          if (cached) {
            this.logger.debug(`Returning stale cached data for ${coinGeckoId} due to rate limit`);
            return cached;
          }
        }

        // Handle 404 - coin not found
        if (error.response?.status === 404) {
          throw new CoinNotFoundException(coinGeckoId, 'slug');
        }
      }

      throw error;
    }
  }

  /**
   * T016/T036: Fetch market chart data from CoinGecko API with Redis caching
   * @param coinGeckoId CoinGecko coin identifier
   * @param days Number of days of historical data (1, 7, 30, 365)
   * @returns Market chart data with prices, market caps, and volumes
   * @note Cached for 5 minutes to minimize API calls
   */
  private async fetchMarketChart(coinGeckoId: string, days: number): Promise<CoinGeckoMarketChart> {
    const cacheKey = `coingecko:chart:${coinGeckoId}:${days}d`;
    const staleCacheKey = `coingecko:chart:stale:${coinGeckoId}:${days}d`;
    const CACHE_TTL_MAP: Record<number, number> = { 1: 300, 7: 900, 30: 1800, 365: 3600 };
    const CACHE_TTL = CACHE_TTL_MAP[days] || 300;
    const STALE_CACHE_TTL = 86400; // 24 hours

    try {
      // Try to get from cache first
      const cached = await this.cacheManager.get<CoinGeckoMarketChart>(cacheKey);
      if (cached) {
        this.logger.debug(`CoinGecko chart cache HIT for ${coinGeckoId} (${days}d)`);
        return cached;
      }

      this.logger.debug(`CoinGecko chart cache MISS for ${coinGeckoId} (${days}d), fetching from API`);

      // Check circuit breaker before calling CoinGecko
      if (this.circuitBreaker.isOpen(CoinService.CIRCUIT_KEY)) {
        this.logger.warn(`Circuit breaker OPEN for CoinGecko chart, skipping API call for ${coinGeckoId} (${days}d)`);
        return this.getStaleChartData(staleCacheKey, coinGeckoId, days);
      }

      // Fetch from API with timeout
      const timeoutMs = 30000; // 30 second timeout (CoinGecko can be slow)

      const requestParams = {
        id: coinGeckoId,
        vs_currency: 'usd',
        days
      };

      const chartDataPromise = this.gecko.coinIdMarketChart(requestParams) as Promise<CoinGeckoMarketChart>;

      let timeoutId: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('CoinGecko API timeout')), timeoutMs);
      });

      const chartData = await Promise.race([chartDataPromise, timeoutPromise]).finally(() => clearTimeout(timeoutId));

      // Record success with circuit breaker
      this.circuitBreaker.recordSuccess(CoinService.CIRCUIT_KEY);

      // Cache the result with period-appropriate TTL
      await this.cacheManager.set(cacheKey, chartData, CACHE_TTL);
      // Also store a long-lived stale fallback
      await this.cacheManager.set(staleCacheKey, chartData, STALE_CACHE_TTL);
      this.logger.debug(`Cached CoinGecko chart for ${coinGeckoId} (${days}d, TTL: ${CACHE_TTL}s)`);

      return chartData;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error fetching chart data for ${coinGeckoId} (${days}d): ${errMsg}`);

      // Record failure with circuit breaker (skip for CircuitOpenError — already counted)
      if (!(error instanceof CircuitOpenError)) {
        this.circuitBreaker.recordFailure(CoinService.CIRCUIT_KEY);
      }

      // For any failure, try primary cache first, then stale fallback
      const primaryCached = await this.cacheManager.get<CoinGeckoMarketChart>(cacheKey);
      if (primaryCached) {
        this.logger.warn(`Returning cached chart for ${coinGeckoId} (${days}d) after error: ${errMsg}`);
        return primaryCached;
      }

      return this.getStaleChartData(staleCacheKey, coinGeckoId, days);
    }
  }

  /**
   * Attempt to return stale cached chart data as a last resort.
   * Throws if no stale data is available.
   */
  private async getStaleChartData(
    staleCacheKey: string,
    coinGeckoId: string,
    days: number
  ): Promise<CoinGeckoMarketChart> {
    const stale = await this.cacheManager.get<CoinGeckoMarketChart>(staleCacheKey);
    if (stale) {
      this.logger.warn(`Returning 24h stale cache for ${coinGeckoId} (${days}d)`);
      return stale;
    }
    throw new Error('Unable to fetch chart data. Please try again later.');
  }

  /**
   * T017: Get comprehensive coin detail by slug
   * Merges database data with CoinGecko data for complete coin information
   * @param slug Coin slug (e.g., 'bitcoin')
   * @returns CoinDetailResponseDto with all coin information
   * @throws NotFoundException if coin not found by slug
   */
  async getCoinDetailBySlug(slug: string): Promise<CoinDetailResponseDto> {
    const { dto } = await this.getCoinDetailWithEntity(slug);
    return dto;
  }

  /**
   * Get coin detail DTO and the underlying entity in a single DB query.
   * Used by the controller to avoid a redundant getCoinBySlug() call for holdings.
   */
  async getCoinDetailWithEntity(slug: string): Promise<{ dto: CoinDetailResponseDto; entity: Coin }> {
    // Query coin from database
    const coin = await this.coin.findOne({ where: { slug } });
    if (!coin) {
      throw new CoinNotFoundException(slug, 'slug');
    }

    // Check if metadata is stale (older than 24 hours)
    const METADATA_STALE_HOURS = 24;
    const now = new Date();
    const metadataAge = coin.metadataLastUpdated ? now.getTime() - coin.metadataLastUpdated.getTime() : Infinity;
    const metadataStale = metadataAge > METADATA_STALE_HOURS * 60 * 60 * 1000;

    let geckoData: CoinGeckoCoinDetail | null = null;

    // Fetch additional data from CoinGecko if metadata is stale
    if (metadataStale && coin.slug) {
      try {
        geckoData = await this.fetchCoinDetail(coin.slug);

        // Update database with fresh metadata
        if (geckoData) {
          const links: Coin['links'] = {
            homepage: geckoData.links?.homepage ?? [],
            blockchainSite: geckoData.links?.blockchain_site?.filter((url: string) => url) ?? [],
            officialForumUrl: geckoData.links?.official_forum_url ?? [],
            subredditUrl: geckoData.links?.subreddit_url ?? undefined,
            reposUrl: { github: geckoData.links?.repos_url?.github ?? [] }
          };

          // Fire-and-forget: the in-memory coin object already has fresh data for the response.
          // If the write fails, the next request will retry (staleness check still triggers).
          this.coin
            .update(coin.id, {
              description: stripHtml(geckoData.description?.en || '') || coin.description,
              links,
              metadataLastUpdated: now
            })
            .catch((err) => this.logger.error(`Failed to persist metadata for ${slug}: ${err.message}`));

          // Update local coin object
          coin.description = stripHtml(geckoData.description?.en || '') || coin.description;
          coin.links = links;
          coin.metadataLastUpdated = now;
        }
      } catch (error: unknown) {
        this.logger.error(
          `Failed to fetch CoinGecko data for ${slug}: ${error instanceof Error ? error.message : error}`
        );
        // Continue with database data only
      }
    }

    // Merge database + CoinGecko data into DTO
    const dto: CoinDetailResponseDto = {
      id: coin.id,
      slug: coin.slug,
      name: coin.name,
      symbol: coin.symbol,
      imageUrl: coin.image || '',
      currentPrice: coin.currentPrice || 0,
      priceChange24h: coin.priceChange24h || 0,
      priceChange24hPercent: coin.priceChangePercentage24h || 0,
      marketCap: coin.marketCap || 0,
      marketCapRank: coin.marketRank ?? undefined,
      volume24h: coin.totalVolume || 0,
      circulatingSupply: coin.circulatingSupply || 0,
      totalSupply: coin.totalSupply ?? undefined,
      maxSupply: coin.maxSupply ?? undefined,
      description: stripHtml(coin.description || ''),
      links: coin.links
        ? {
            homepage: coin.links.homepage ?? [],
            blockchainSite: coin.links.blockchainSite ?? [],
            officialForumUrl: coin.links.officialForumUrl ?? [],
            subredditUrl: coin.links.subredditUrl,
            repositoryUrl: coin.links.reposUrl?.github?.filter((u: string) => u) ?? []
          }
        : { homepage: [], blockchainSite: [], officialForumUrl: [], repositoryUrl: [] },
      ath: coin.ath ?? undefined,
      athChangePercent: coin.athChange ?? undefined,
      athDate: coin.athDate ?? undefined,
      lastUpdated: coin.updatedAt,
      metadataLastUpdated: coin.metadataLastUpdated ?? undefined
    };

    return { dto, entity: coin };
  }

  /**
   * T018: Get market chart data for a coin
   * @param slug Coin slug (e.g., 'bitcoin')
   * @param period Time period ('24h', '7d', '30d', '1y')
   * @returns MarketChartResponseDto with historical price data
   * @throws NotFoundException if coin not found by slug
   */
  async getMarketChart(slug: string, period: TimePeriod): Promise<MarketChartResponseDto> {
    // Query coin from database
    const coin = await this.coin.findOne({ where: { slug } });
    if (!coin) {
      throw new CoinNotFoundException(slug, 'slug');
    }

    // Map period to days
    const periodDaysMap: Record<TimePeriod, number> = {
      '24h': 1,
      '7d': 7,
      '30d': 30,
      '1y': 365
    };

    const days = periodDaysMap[period];

    // Fetch from CoinGecko with caching — let errors propagate so the frontend shows an error state
    const chartData = await this.fetchMarketChart(coin.slug, days);

    // Transform CoinGecko response to MarketChartResponseDto
    const response: MarketChartResponseDto = {
      coinSlug: coin.slug,
      period,
      prices:
        chartData.prices?.map((point: [number, number]) => ({
          timestamp: point[0],
          price: point[1]
        })) || [],
      timestamps: chartData.prices?.map((point: [number, number]) => point[0]) || [],
      generatedAt: new Date()
    };

    return response;
  }
}
