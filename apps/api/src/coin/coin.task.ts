import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CoinGeckoClient } from 'coingecko-api-v3';

import { CoinService } from './coin.service';

@Injectable()
export class CoinTask {
  private readonly gecko = new CoinGeckoClient({ timeout: 10000, autoRetry: true });
  private readonly logger = new Logger(CoinTask.name);
  constructor(private readonly coin: CoinService) {}

  @Cron(CronExpression.EVERY_WEEK)
  async syncCoins() {
    try {
      this.logger.log('Starting Coin Sync');
      const [geckoCoins, existingCoins] = await Promise.all([
        this.gecko.coinList({ include_platform: false }),
        this.coin.getCoins()
      ]);

      const newCoins = geckoCoins
        .map(({ id: slug, symbol, name }) => ({ slug, symbol, name }))
        .filter((coin) => !existingCoins.find((existing) => existing.slug === coin.slug));

      const missingCoins = existingCoins
        .filter((existing) => !geckoCoins.find((api) => api.id === existing.slug))
        .map((coin) => coin.id);

      if (newCoins.length > 0) {
        await this.coin.createMany(newCoins);
        this.logger.log(`Added ${newCoins.length} new coins`);
      }

      if (missingCoins.length > 0) {
        await this.coin.removeMany(missingCoins);
        this.logger.log(`Removed ${missingCoins.length} delisted coins`);
      }
    } catch (e) {
      this.logger.error('Coin sync failed:', e);
    } finally {
      this.logger.log('Coin Sync Complete');
    }
  }
}
