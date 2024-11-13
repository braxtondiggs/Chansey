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

      const geckoSlugs = new Set(geckoCoins.map((coin) => coin.id));

      const toDelete = existingCoins.filter((coin) => !geckoSlugs.has(coin.slug));

      const newCoins = geckoCoins.filter((coin) => !existingCoins.some((existing) => existing.slug === coin.id));
      if (newCoins.length > 0) {
        await Promise.all(newCoins.map(({ id: slug, symbol, name }) => this.coin.create({ slug, symbol, name })));
        this.logger.log(`Added ${newCoins.length} new coins`);
      }

      if (toDelete.length > 0) {
        await Promise.all(toDelete.map((coin) => this.coin.remove(coin.id)));
        this.logger.log(`Removed ${toDelete.length} delisted coins`);
      }
    } catch (e) {
      this.logger.error('Coin sync failed:', e);
    } finally {
      this.logger.log('Coin Sync Complete');
    }
  }
}
