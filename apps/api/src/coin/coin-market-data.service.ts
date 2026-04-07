import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { NotFoundError, RateLimitError } from '@coingecko/coingecko-typescript';
import type { CoinGetIDResponse } from '@coingecko/coingecko-typescript/resources/coins/coins';
import type { MarketChartGetResponse } from '@coingecko/coingecko-typescript/resources/coins/market-chart';
import { Cache } from 'cache-manager';
import { Repository } from 'typeorm';

import { CoinDetailResponseDto, MarketChartResponseDto, TimePeriod } from '@chansey/api-interfaces';

import { Coin } from './coin.entity';
import { CoinService } from './coin.service';

import { CoinNotFoundException } from '../common/exceptions/resource';
import { CircuitBreakerService, CircuitOpenError } from '../shared';
import { CoinGeckoClientService } from '../shared/coingecko-client.service';
import { stripHtml } from '../utils/strip-html.util';

interface HistoricalDataPoint {
  timestamp: number;
  price: number;
  volume: number;
  marketCap?: number;
}

@Injectable()
export class CoinMarketDataService {
  private readonly logger = new Logger(CoinMarketDataService.name);

  private static readonly CIRCUIT_KEY = 'coingecko-chart';

  constructor(
    @InjectRepository(Coin) private readonly coin: Repository<Coin>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly coinService: CoinService,
    private readonly gecko: CoinGeckoClientService
  ) {
    this.circuitBreaker.configure(CoinMarketDataService.CIRCUIT_KEY, {
      failureThreshold: 3,
      resetTimeoutMs: 60000
    });
  }

  async getCoinHistoricalData(coinId: string): Promise<HistoricalDataPoint[]> {
    const coin = await this.coinService.getCoinById(coinId);

    try {
      const geckoData = await this.gecko.client.coins.marketChart.get(coin.slug, {
        vs_currency: 'usd',
        days: '365', // !NOTE: Max value w/o paying money
        interval: 'daily'
      });

      if (geckoData?.prices && geckoData.prices.length > 0) {
        return geckoData.prices.map((point, index) => ({
          timestamp: point[0],
          price: point[1],
          volume: geckoData.total_volumes?.[index]?.[1] ?? 0,
          marketCap: geckoData.market_caps?.[index]?.[1] ?? 0
        }));
      }

      return [];
    } catch (error: unknown) {
      if (error instanceof NotFoundError) {
        throw new CoinNotFoundException(coinId);
      }
      this.logger.error(
        `Failed to fetch historical data for ${coinId}: ${error instanceof Error ? error.message : error}`
      );
      throw error;
    }
  }

  /**
   * T017: Get comprehensive coin detail by slug
   * Merges database data with CoinGecko data for complete coin information
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

    let geckoData: CoinGetIDResponse | null = null;

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
        chartData.prices?.map((point) => ({
          timestamp: point[0],
          price: point[1]
        })) || [],
      timestamps: chartData.prices?.map((point) => point[0]) || [],
      generatedAt: new Date()
    };

    return response;
  }

  /**
   * T016/T036: Fetch coin detail from CoinGecko API with Redis caching
   */
  private async fetchCoinDetail(coinGeckoId: string): Promise<CoinGetIDResponse> {
    const cacheKey = `coingecko:detail:${coinGeckoId}`;
    const CACHE_TTL = 300; // 5 minutes in seconds

    try {
      // Try to get from cache first
      const cached = await this.cacheManager.get<CoinGetIDResponse>(cacheKey);
      if (cached) {
        this.logger.debug(`CoinGecko detail cache HIT for ${coinGeckoId}`);
        return cached;
      }

      this.logger.debug(`CoinGecko detail cache MISS for ${coinGeckoId}, fetching from API`);

      // Fetch from API
      const coinDetail = await this.gecko.client.coins.getID(coinGeckoId, {
        localization: false,
        tickers: false,
        market_data: true,
        community_data: false,
        developer_data: false
      });

      // Cache the result
      await this.cacheManager.set(cacheKey, coinDetail, CACHE_TTL);
      this.logger.debug(`Cached CoinGecko detail for ${coinGeckoId} (TTL: ${CACHE_TTL}s)`);

      return coinDetail;
    } catch (error: unknown) {
      // Handle rate limiting (429) by trying to return cached data
      if (error instanceof RateLimitError) {
        this.logger.warn(`CoinGecko rate limit hit for ${coinGeckoId}, attempting to use cached data`);
        const cached = await this.cacheManager.get<CoinGetIDResponse>(cacheKey);
        if (cached) {
          this.logger.debug(`Returning stale cached data for ${coinGeckoId} due to rate limit`);
          return cached;
        }
      }

      // Handle 404 - coin not found
      if (error instanceof NotFoundError) {
        throw new CoinNotFoundException(coinGeckoId, 'slug');
      }

      throw error;
    }
  }

  /**
   * T016/T036: Fetch market chart data from CoinGecko API with Redis caching
   */
  private async fetchMarketChart(coinGeckoId: string, days: number): Promise<MarketChartGetResponse> {
    const cacheKey = `coingecko:chart:${coinGeckoId}:${days}d`;
    const staleCacheKey = `coingecko:chart:stale:${coinGeckoId}:${days}d`;
    const CACHE_TTL_MAP: Record<number, number> = { 1: 300, 7: 900, 30: 1800, 365: 3600 };
    const CACHE_TTL = CACHE_TTL_MAP[days] || 300;
    const STALE_CACHE_TTL = 86400; // 24 hours

    try {
      // Try to get from cache first
      const cached = await this.cacheManager.get<MarketChartGetResponse>(cacheKey);
      if (cached) {
        this.logger.debug(`CoinGecko chart cache HIT for ${coinGeckoId} (${days}d)`);
        return cached;
      }

      this.logger.debug(`CoinGecko chart cache MISS for ${coinGeckoId} (${days}d), fetching from API`);

      // Check circuit breaker before calling CoinGecko
      if (this.circuitBreaker.isOpen(CoinMarketDataService.CIRCUIT_KEY)) {
        this.logger.warn(`Circuit breaker OPEN for CoinGecko chart, skipping API call for ${coinGeckoId} (${days}d)`);
        return this.getStaleChartData(staleCacheKey, coinGeckoId, days);
      }

      // Fetch from API with timeout
      const timeoutMs = 30000; // 30 second timeout (CoinGecko can be slow)

      const chartDataPromise = this.gecko.client.coins.marketChart.get(coinGeckoId, {
        vs_currency: 'usd',
        days: String(days)
      });

      let timeoutId: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('CoinGecko API timeout')), timeoutMs);
      });

      const chartData = await Promise.race([chartDataPromise, timeoutPromise]).finally(() => clearTimeout(timeoutId));

      // Record success with circuit breaker
      this.circuitBreaker.recordSuccess(CoinMarketDataService.CIRCUIT_KEY);

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
        this.circuitBreaker.recordFailure(CoinMarketDataService.CIRCUIT_KEY);
      }

      // For any failure, try primary cache first, then stale fallback
      const primaryCached = await this.cacheManager.get<MarketChartGetResponse>(cacheKey);
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
  ): Promise<MarketChartGetResponse> {
    const stale = await this.cacheManager.get<MarketChartGetResponse>(staleCacheKey);
    if (stale) {
      this.logger.warn(`Returning 24h stale cache for ${coinGeckoId} (${days}d)`);
      return stale;
    }
    throw new Error('Unable to fetch chart data. Please try again later.');
  }
}
