import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CoinGeckoClient } from 'coingecko-api-v3';

import { PriceService } from './price.service';
import { PortfolioService } from '../portfolio/portfolio.service';
import { CreatePriceDto } from './dto/create-price.dto';
import { HealthCheckHelper } from '../utils/health-check.helper';

@Injectable()
export class PriceTaskService {
  private readonly gecko = new CoinGeckoClient({ timeout: 10000, autoRetry: true });
  private readonly logger = new Logger(PriceTaskService.name);
  private readonly BATCH_SIZE = 50; // CoinGecko has a limit on number of coins per request

  constructor(
    private readonly portfolio: PortfolioService,
    private readonly price: PriceService,
    private readonly healthCheck: HealthCheckHelper
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async getPrices() {
    const hc_uuid = 'f0cd3029-25c7-4f95-b170-f6e716fd7bd0';
    try {
      this.logger.log('Starting Price Sync');
      await this.healthCheck.ping(hc_uuid, 'start');

      const coins = await this.portfolio.getPortfolioCoins();

      // Process coins in batches
      for (let i = 0; i < coins.length; i += this.BATCH_SIZE) {
        const batch = coins.slice(i, i + this.BATCH_SIZE);
        const ids = batch.map(({ slug }) => slug).join(',');

        try {
          const prices = await this.gecko.simplePrice({
            ids,
            vs_currencies: 'usd',
            include_24hr_vol: true,
            include_market_cap: true,
            include_last_updated_at: true
          });

          const updates: CreatePriceDto[] = batch
            .map((coin) => {
              const coinData = prices[coin.slug];
              if (!coinData) {
                this.logger.warn(`No price data found for ${coin.name} (${coin.slug})`);
                return null;
              }

              return {
                price: coinData.usd,
                marketCap: coinData.usd_market_cap,
                totalVolume: coinData.usd_24h_vol,
                geckoLastUpdatedAt: new Date(coinData.last_updated_at * 1000),
                coin: coin,
                coinId: coin.id
              };
            })
            .filter(Boolean);

          await Promise.all(
            updates.map(async (update) => {
              try {
                await this.price.create(update);
              } catch (error) {
                this.logger.error(`Failed to update price for coin ${update.coinId}:`, error);
              }
            })
          );
        } catch (error) {
          this.logger.error(`Failed to fetch prices for batch starting with ${batch[0].slug}:`, error);
        }
      }
    } catch (e) {
      this.logger.error('Price sync failed:', e);
      await this.healthCheck.ping(hc_uuid, 'fail');
    } finally {
      this.logger.log('Price Sync Complete');
      await this.healthCheck.ping(hc_uuid);
    }
  }
}
