import { Injectable, Logger } from '@nestjs/common';

import { mapCoinGeckoDetailToMetadataUpdate } from './map-coingecko-detail.util';
import { mapCoinGeckoMarketsToUpdate } from './map-coingecko-markets.util';

import { CircuitBreakerService } from '../../shared/circuit-breaker.service';
import { CoinGeckoClientService } from '../../shared/coingecko-client.service';
import { toErrorInfo } from '../../shared/error.util';
import { withRateLimitRetry } from '../../shared/retry.util';
import { Coin } from '../coin.entity';
import { CoinService } from '../coin.service';

@Injectable()
export class CoinDetailSyncService {
  private static readonly CIRCUIT_KEY = 'coingecko-detail';
  private static readonly CIRCUIT_RESET_MS = 45_000;
  private static readonly MAX_BACKOFF_MS = 5 * 60_000;
  private static readonly BACKOFF_MULTIPLIER = 2;
  private static readonly NORMAL_BATCH_DELAY_MS = 3000;
  private static readonly ELEVATED_BATCH_DELAY_MS = 6000;
  private static readonly SUCCESS_BATCHES_TO_NORMALIZE = 3;
  private static readonly MARKETS_BATCH_SIZE = 250;
  private static readonly METADATA_MIN_AGE_MS = 25 * 24 * 60 * 60 * 1000; // skip coins refreshed within 25 days
  private readonly logger = new Logger(CoinDetailSyncService.name);

  constructor(
    private readonly coinService: CoinService,
    private readonly gecko: CoinGeckoClientService,
    private readonly circuitBreaker: CircuitBreakerService
  ) {
    this.circuitBreaker.configure(CoinDetailSyncService.CIRCUIT_KEY, {
      failureThreshold: 5,
      resetTimeoutMs: CoinDetailSyncService.CIRCUIT_RESET_MS
    });
  }

  /**
   * Daily sync — batches all coins through /coins/markets (250 per call) to refresh
   * price, market cap, volume, supply, ATH/ATL, and price-change percentages.
   * Metadata fields (description, links, scores, sentiment) are refreshed separately
   * by syncCoinMetadata() on a monthly cadence.
   *
   * @param onProgress Optional callback to report progress (0-100).
   */
  async syncCoinDetails(
    onProgress?: (percent: number) => Promise<void>
  ): Promise<{ totalCoins: number; updatedSuccessfully: number; errors: number }> {
    this.logger.log('Starting Coin Markets Sync');
    await onProgress?.(5);

    const allCoins = await this.coinService.getCoins();
    await onProgress?.(10);

    await this.applyTrendingRanks(allCoins);
    await onProgress?.(30);

    if (allCoins.length === 0) {
      await onProgress?.(100);
      return { totalCoins: 0, updatedSuccessfully: 0, errors: 0 };
    }

    let updatedCount = 0;
    let errorCount = 0;
    const startedAt = Date.now();
    let consecutivePauses = 0;
    let currentBatchDelay = CoinDetailSyncService.NORMAL_BATCH_DELAY_MS;
    let successBatchesSincePause = 0;

    const coinsBySlug = new Map(allCoins.map((c) => [c.slug, c]));
    const batchSize = CoinDetailSyncService.MARKETS_BATCH_SIZE;

    for (let i = 0; i < allCoins.length; i += batchSize) {
      if (this.circuitBreaker.isOpen(CoinDetailSyncService.CIRCUIT_KEY)) {
        consecutivePauses++;
        const backoffMs = Math.min(
          CoinDetailSyncService.CIRCUIT_RESET_MS *
            Math.pow(CoinDetailSyncService.BACKOFF_MULTIPLIER, consecutivePauses - 1),
          CoinDetailSyncService.MAX_BACKOFF_MS
        );
        this.logger.warn(
          `Circuit open — pausing ${CoinDetailSyncService.CIRCUIT_KEY} for ${(backoffMs / 1000).toFixed(0)}s (pause #${consecutivePauses})`
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        currentBatchDelay = CoinDetailSyncService.ELEVATED_BATCH_DELAY_MS;
        successBatchesSincePause = 0;
        i -= batchSize;
        continue;
      }

      const batch = allCoins.slice(i, i + batchSize);
      const { success, fail } = await this.updateMarketsBatch(batch, coinsBySlug);
      updatedCount += success;
      errorCount += fail;

      if (success > 0) {
        consecutivePauses = 0;
        if (fail === 0) {
          successBatchesSincePause++;
          if (successBatchesSincePause >= CoinDetailSyncService.SUCCESS_BATCHES_TO_NORMALIZE) {
            currentBatchDelay = CoinDetailSyncService.NORMAL_BATCH_DELAY_MS;
          }
        } else {
          successBatchesSincePause = 0;
        }
      }

      const elapsedMinutes = ((Date.now() - startedAt) / 60_000).toFixed(1);
      this.logger.log(
        `coin-market-sync progress: ${Math.min(i + batchSize, allCoins.length)}/${allCoins.length} (${elapsedMinutes}m elapsed)`
      );

      const progressPercent = Math.min(35 + Math.floor(((i + batchSize) / allCoins.length) * 60), 95);
      await onProgress?.(progressPercent);

      if (i + batchSize < allCoins.length) {
        await new Promise((resolve) => setTimeout(resolve, currentBatchDelay));
      }
    }

    await onProgress?.(100);
    this.logger.log('Coin Markets Sync Complete');

    return {
      totalCoins: allCoins.length,
      updatedSuccessfully: updatedCount,
      errors: errorCount
    };
  }

  /**
   * Monthly sync — refreshes metadata fields (description, genesis, scores, sentiment)
   * via per-coin /coins/{id}. Coins whose metadata was updated within
   * `METADATA_MIN_AGE_MS` (25 days) are skipped — popular coins get refreshed lazily
   * when users view their detail pages via CoinMarketDataService.
   */
  async syncCoinMetadata(
    onProgress?: (percent: number) => Promise<void>
  ): Promise<{ totalCoins: number; updatedSuccessfully: number; skipped: number; errors: number }> {
    this.logger.log('Starting Coin Metadata Sync');
    await onProgress?.(5);

    this.logger.log('Clearing previous rank data...');
    await this.coinService.clearRank();
    await onProgress?.(8);

    const allCoins = await this.coinService.getCoins();
    const cutoff = Date.now() - CoinDetailSyncService.METADATA_MIN_AGE_MS;
    const coinsToRefresh = allCoins.filter((c) => {
      const lastUpdated = c.metadataLastUpdated ? new Date(c.metadataLastUpdated).getTime() : 0;
      return lastUpdated < cutoff;
    });
    const skipped = allCoins.length - coinsToRefresh.length;

    this.logger.log(
      `Metadata sync: ${coinsToRefresh.length} coins need refresh, ${skipped} skipped (refreshed within 25d)`
    );
    await onProgress?.(10);

    if (coinsToRefresh.length === 0) {
      await onProgress?.(100);
      return { totalCoins: allCoins.length, updatedSuccessfully: 0, skipped, errors: 0 };
    }

    let updatedCount = 0;
    let errorCount = 0;
    const batchSize = 1;
    const startedAt = Date.now();
    let batchIndex = 0;
    let consecutivePauses = 0;
    let currentBatchDelay = CoinDetailSyncService.NORMAL_BATCH_DELAY_MS;
    let successBatchesSincePause = 0;

    for (let i = 0; i < coinsToRefresh.length; i += batchSize) {
      if (this.circuitBreaker.isOpen(CoinDetailSyncService.CIRCUIT_KEY)) {
        consecutivePauses++;
        const backoffMs = Math.min(
          CoinDetailSyncService.CIRCUIT_RESET_MS *
            Math.pow(CoinDetailSyncService.BACKOFF_MULTIPLIER, consecutivePauses - 1),
          CoinDetailSyncService.MAX_BACKOFF_MS
        );
        this.logger.warn(
          `Circuit open — pausing metadata sync for ${(backoffMs / 1000).toFixed(0)}s (pause #${consecutivePauses})`
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        currentBatchDelay = CoinDetailSyncService.ELEVATED_BATCH_DELAY_MS;
        successBatchesSincePause = 0;
        i -= batchSize;
        continue;
      }

      const batch = coinsToRefresh.slice(i, i + batchSize);
      const results = await this.updateMetadataBatch(batch);

      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;
      updatedCount += successCount;
      errorCount += failCount;

      if (successCount > 0) {
        consecutivePauses = 0;
        if (failCount === 0) {
          successBatchesSincePause++;
          if (successBatchesSincePause >= CoinDetailSyncService.SUCCESS_BATCHES_TO_NORMALIZE) {
            currentBatchDelay = CoinDetailSyncService.NORMAL_BATCH_DELAY_MS;
          }
        } else {
          successBatchesSincePause = 0;
        }
      }

      batchIndex++;
      if (batchIndex % 30 === 0) {
        const elapsedMinutes = ((Date.now() - startedAt) / 60_000).toFixed(1);
        this.logger.log(
          `coin-metadata-sync progress: ${Math.min(i + batchSize, coinsToRefresh.length)}/${coinsToRefresh.length} (${elapsedMinutes}m elapsed)`
        );
      }

      const progressPercent = Math.min(15 + Math.floor(((i + batchSize) / coinsToRefresh.length) * 80), 95);
      await onProgress?.(progressPercent);

      if (i + batchSize < coinsToRefresh.length) {
        await new Promise((resolve) => setTimeout(resolve, currentBatchDelay));
      }
    }

    await onProgress?.(100);
    this.logger.log('Coin Metadata Sync Complete');

    return {
      totalCoins: allCoins.length,
      updatedSuccessfully: updatedCount,
      skipped,
      errors: errorCount
    };
  }

  /**
   * Fetches trending coins from CoinGecko and applies their rank scores to matching coins.
   */
  private async applyTrendingRanks(coins: Coin[]): Promise<void> {
    this.logger.log('Fetching trending coins from CoinGecko...');
    try {
      const trendingResponse = await this.gecko.client.search.trending.get();
      for (const trendingCoin of trendingResponse.coins ?? []) {
        const itemId = trendingCoin.id;
        if (!itemId) continue;
        const existingCoin = coins.find((coin) => coin.slug === itemId);
        if (existingCoin) {
          existingCoin.geckoRank = trendingCoin.score;
        }
      }
    } catch (error: unknown) {
      const { message } = toErrorInfo(error);
      this.logger.warn(`Failed to fetch trending coins: ${message}. Continuing without trending ranks.`);
    }
  }

  /**
   * Fetches /coins/markets for a batch of up to 250 coins and updates the DB.
   * One API call per batch.
   */
  private async updateMarketsBatch(
    batch: Coin[],
    coinsBySlug: Map<string, Coin>
  ): Promise<{ success: number; fail: number }> {
    if (batch.length === 0) return { success: 0, fail: 0 };

    const ids = batch.map((c) => c.slug).join(',');

    const retryResult = await withRateLimitRetry(
      () =>
        this.gecko.client.coins.markets.get({
          vs_currency: 'usd',
          ids,
          per_page: CoinDetailSyncService.MARKETS_BATCH_SIZE,
          price_change_percentage: '24h,7d,14d,30d,200d,1y'
        } as any),
      {
        maxRetries: 3,
        logger: this.logger,
        operationName: `markets(${batch.length} coins)`
      }
    );

    if (retryResult.success) {
      this.circuitBreaker.recordSuccess(CoinDetailSyncService.CIRCUIT_KEY);
    } else {
      this.circuitBreaker.recordFailure(CoinDetailSyncService.CIRCUIT_KEY);
      const { message } = toErrorInfo(retryResult.error);
      this.logger.error(`Failed to fetch markets batch: ${message}`);
      return { success: 0, fail: batch.length };
    }

    const entries = (retryResult.result ?? []) as Array<Record<string, any>>;
    let success = 0;
    let fail = 0;

    for (const entry of entries) {
      const slug = entry.id;
      if (!slug) continue;
      const coin = coinsBySlug.get(slug);
      if (!coin) continue;

      try {
        const updateDto = mapCoinGeckoMarketsToUpdate(entry, coin.geckoRank, coin.symbol);
        await this.coinService.update(coin.id, updateDto);
        success++;
      } catch (error: unknown) {
        const { message } = toErrorInfo(error);
        this.logger.error(`Failed to persist markets update for ${coin.symbol}: ${message}`);
        fail++;
      }
    }

    // Coins in batch that had no entry in the response are counted as failures
    const returnedSlugs = new Set(entries.map((e) => e.id).filter(Boolean));
    const missing = batch.filter((c) => !returnedSlugs.has(c.slug)).length;
    fail += missing;

    return { success, fail };
  }

  /**
   * Fetches detailed info for a batch of coins and updates the database (metadata only).
   */
  private async updateMetadataBatch(batch: Coin[]): Promise<{ success: boolean; error?: string }[]> {
    return Promise.all(
      batch.map(async ({ id, slug, symbol }) => {
        try {
          this.logger.debug(`Refreshing metadata for ${symbol} (${slug})`);

          const retryResult = await withRateLimitRetry(
            () =>
              this.gecko.client.coins.getID(slug, {
                localization: false,
                tickers: false,
                market_data: false,
                community_data: true,
                developer_data: true
              } as any),
            {
              maxRetries: 3,
              logger: this.logger,
              operationName: `coinMetadata(${symbol})`
            }
          );

          if (retryResult.success) {
            this.circuitBreaker.recordSuccess(CoinDetailSyncService.CIRCUIT_KEY);
          } else {
            this.circuitBreaker.recordFailure(CoinDetailSyncService.CIRCUIT_KEY);
          }

          if (!retryResult.success) {
            const { message } = toErrorInfo(retryResult.error);
            this.logger.error(`Failed to refresh metadata for ${symbol}: ${message}`);
            return { success: false, error: message };
          }

          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by retryResult.success check
          const coin = retryResult.result!;
          const updateDto = {
            ...mapCoinGeckoDetailToMetadataUpdate(coin, symbol),
            metadataLastUpdated: new Date()
          };
          await this.coinService.update(id, updateDto);

          this.logger.debug(`Successfully refreshed metadata for ${symbol}`);
          return { success: true };
        } catch (error: unknown) {
          const { message } = toErrorInfo(error);
          this.logger.error(`Failed to refresh metadata for ${symbol}: ${message}`);
          return { success: false, error: message };
        }
      })
    );
  }
}
