import { Injectable, Logger } from '@nestjs/common';

import { mapCoinGeckoDetailToUpdate } from './map-coingecko-detail.util';

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
   * Syncs detailed coin information from CoinGecko for all coins in the database.
   * @param onProgress Optional callback to report progress (0-100).
   */
  async syncCoinDetails(
    onProgress?: (percent: number) => Promise<void>
  ): Promise<{ totalCoins: number; updatedSuccessfully: number; errors: number }> {
    this.logger.log('Starting Detailed Coins Update');
    await onProgress?.(5);

    this.logger.log('Clearing previous rank data...');
    await this.coinService.clearRank();
    await onProgress?.(10);

    const allCoins = await this.coinService.getCoins();

    await this.applyTrendingRanks(allCoins);
    await onProgress?.(30);

    let updatedCount = 0;
    let errorCount = 0;
    const batchSize = 1;
    const startedAt = Date.now();
    let batchIndex = 0;
    let consecutivePauses = 0;
    let currentBatchDelay = CoinDetailSyncService.NORMAL_BATCH_DELAY_MS;
    let successBatchesSincePause = 0;

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
      const results = await this.updateCoinBatch(batch);

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

      // Heartbeat every 30 batches (~75–150s depending on batch delay).
      // Gives Loki enough datapoints to alert via `absent_over_time`
      // with a tight window, without spamming.
      batchIndex++;
      if (batchIndex % 30 === 0) {
        const elapsedMinutes = ((Date.now() - startedAt) / 60_000).toFixed(1);
        this.logger.log(
          `coin-detail progress: ${Math.min(i + batchSize, allCoins.length)}/${allCoins.length} (${elapsedMinutes}m elapsed)`
        );
      }

      const progressPercent = Math.min(35 + Math.floor(((i + batchSize) / allCoins.length) * 60), 95);
      await onProgress?.(progressPercent);

      if (i + batchSize < allCoins.length) {
        await new Promise((resolve) => setTimeout(resolve, currentBatchDelay));
      }
    }

    await onProgress?.(100);
    this.logger.log('Detailed Coins Update Complete');

    return {
      totalCoins: allCoins.length,
      updatedSuccessfully: updatedCount,
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
   * Fetches detailed info for a batch of coins and updates the database.
   */
  private async updateCoinBatch(batch: Coin[]): Promise<{ success: boolean; error?: string }[]> {
    return Promise.all(
      batch.map(async ({ id, slug, symbol, geckoRank }) => {
        try {
          this.logger.debug(`Updating details for ${symbol} (${slug})`);

          const retryResult = await withRateLimitRetry(
            () =>
              this.gecko.client.coins.getID(slug, {
                localization: false,
                tickers: false
              }),
            {
              maxRetries: 3,
              logger: this.logger,
              operationName: `coinId(${symbol})`
            }
          );

          if (retryResult.success) {
            this.circuitBreaker.recordSuccess(CoinDetailSyncService.CIRCUIT_KEY);
          } else {
            this.circuitBreaker.recordFailure(CoinDetailSyncService.CIRCUIT_KEY);
          }

          if (!retryResult.success) {
            const { message } = toErrorInfo(retryResult.error);
            this.logger.error(`Failed to update ${symbol}: ${message}`);
            return { success: false, error: message };
          }

          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by retryResult.success check
          const coin = retryResult.result!;
          const updateDto = mapCoinGeckoDetailToUpdate(coin, geckoRank, symbol);
          await this.coinService.update(id, updateDto);

          this.logger.debug(`Successfully updated ${symbol}`);
          return { success: true };
        } catch (error: unknown) {
          const { message } = toErrorInfo(error);
          this.logger.error(`Failed to update ${symbol}: ${message}`);
          return { success: false, error: message };
        }
      })
    );
  }
}
