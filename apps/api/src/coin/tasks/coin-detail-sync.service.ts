import { Injectable, Logger } from '@nestjs/common';

import { mapCoinGeckoDetailToUpdate } from './map-coingecko-detail.util';

import { CoinGeckoClientService } from '../../shared/coingecko-client.service';
import { toErrorInfo } from '../../shared/error.util';
import { withRetry } from '../../shared/retry.util';
import { Coin } from '../coin.entity';
import { CoinService } from '../coin.service';

@Injectable()
export class CoinDetailSyncService {
  private readonly logger = new Logger(CoinDetailSyncService.name);
  private readonly API_RATE_LIMIT_DELAY = 2500;

  constructor(
    private readonly coinService: CoinService,
    private readonly gecko: CoinGeckoClientService
  ) {}

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
    const batchSize = 3;

    for (let i = 0; i < allCoins.length; i += batchSize) {
      const batch = allCoins.slice(i, i + batchSize);
      const results = await this.updateCoinBatch(batch);

      updatedCount += results.filter((r) => r.success).length;
      errorCount += results.filter((r) => !r.success).length;

      const progressPercent = Math.min(35 + Math.floor(((i + batchSize) / allCoins.length) * 60), 95);
      await onProgress?.(progressPercent);

      if (i + batchSize < allCoins.length) {
        await new Promise((resolve) => setTimeout(resolve, this.API_RATE_LIMIT_DELAY));
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

          const retryResult = await withRetry(
            () =>
              this.gecko.client.coins.getID(slug, {
                localization: false,
                tickers: false
              }),
            {
              maxRetries: 2,
              initialDelayMs: 3000,
              maxDelayMs: 10000,
              logger: this.logger,
              operationName: `coinId(${symbol})`
            }
          );

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
