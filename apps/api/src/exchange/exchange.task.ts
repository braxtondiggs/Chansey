import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { CoinGeckoClient } from 'coingecko-api-v3';

import { Exchange } from './exchange.entity';
import { ExchangeService } from './exchange.service';

@Injectable()
export class ExchangeTask {
  private readonly gecko = new CoinGeckoClient({ timeout: 10000, autoRetry: true });
  private readonly logger = new Logger(ExchangeTask.name);

  constructor(private readonly exchange: ExchangeService) {}

  @Cron(CronExpression.EVERY_WEEK)
  async syncExchanges() {
    try {
      this.logger.log('Starting Exchange Sync');

      const existingExchanges = await this.exchange.getExchanges();
      let allApiExchanges = [];
      let page = 1;

      // Fetch all pages
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const apiExchanges = await this.gecko.exchanges({
          per_page: 250,
          page
        });

        if (apiExchanges.length === 0) break;
        allApiExchanges = [...allApiExchanges, ...apiExchanges];
        page++;
      }

      const mapExchange = (ex: any, existing?: Exchange) =>
        new Exchange({
          ...existing,
          name: ex.name,
          slug: ex.id,
          url: ex.url,
          image: ex.image,
          country: ex.country,
          yearEstablished: ex.year_established,
          trustScore: ex.trust_score,
          trustScoreRank: ex.trust_score_rank,
          tradeVolume24HBtc: ex.trade_volume_24h_btc,
          tradeVolume24HNormalized: ex.trade_volume_24h_btc_normalized,
          facebook: ex.facebook_url,
          reddit: ex.reddit_url,
          telegram: ex.telegram_url,
          twitter: ex.twitter_handle,
          otherUrl1: ex.other_url_1,
          otherUrl2: ex.other_url_2,
          centralized: ex.centralized
        });

      const exchangesToSync = allApiExchanges.map((ex) => {
        const existing = existingExchanges.find((e) => e.slug === ex.id);
        return mapExchange(ex, existing);
      });

      const newExchanges = exchangesToSync.filter((ex) => !existingExchanges.find((e) => e.slug === ex.slug));
      const updatedExchanges = exchangesToSync.filter((ex) => existingExchanges.find((e) => e.slug === ex.slug));

      const missingExchanges = existingExchanges
        .filter((existing) => !allApiExchanges.find((api) => api.id === existing.slug))
        .map((ex) => ex.id);

      if (newExchanges.length > 0) {
        await this.exchange.createMany(newExchanges);
        this.logger.log(`Added exchanges: ${newExchanges.map(({ name }) => name).join(', ')}`);
      }

      if (updatedExchanges.length > 0) {
        await this.exchange.updateMany(updatedExchanges);
        this.logger.log(`Updated ${updatedExchanges.length} exchanges`);
      }

      if (missingExchanges.length > 0) {
        await this.exchange.removeMany(missingExchanges);
        this.logger.log(`Removed ${missingExchanges.length} obsolete exchanges`);
      }
    } catch (e) {
      this.logger.error('Exchange sync failed:', e);
    } finally {
      this.logger.log('Exchange Sync Complete');
    }
  }
}
