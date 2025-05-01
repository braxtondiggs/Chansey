import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { CoinGeckoClient, ExchangeId as GeckoExchange } from 'coingecko-api-v3';

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

      // Step 1: Detect and handle duplicate names by making them unique
      const seenNames = new Map();
      const seenSlugs = new Map();
      allApiExchanges = allApiExchanges
        .filter((ex) => {
          // Skip nullish or empty IDs
          if (!ex.id) {
            this.logger.warn(`Skipping exchange with missing ID: ${ex.name || 'Unknown'}`);
            return false;
          }

          // Check for duplicate slugs (IDs)
          if (seenSlugs.has(ex.id)) {
            this.logger.warn(`Skipping duplicate exchange with ID: ${ex.id}`);
            return false;
          }

          seenSlugs.set(ex.id, true);
          return true;
        })
        .map((ex) => {
          // Normalize name to avoid case sensitivity issues
          const normalizedName = ex.name?.trim() || '';

          if (!normalizedName) {
            this.logger.warn(`Exchange with ID ${ex.id} has no name, using ID as name`);
            return { ...ex, name: ex.id };
          }

          if (seenNames.has(normalizedName)) {
            // We have a duplicate name - make it unique by appending the ID
            const uniqueName = `${normalizedName} (${ex.id})`;
            this.logger.log(`Handling duplicate exchange name: "${normalizedName}" -> "${uniqueName}"`);
            const modified = { ...ex, name: uniqueName };
            seenNames.set(uniqueName, true);
            return modified;
          } else {
            // First time seeing this name
            seenNames.set(normalizedName, true);
            return ex;
          }
        });

      this.logger.log(`Processing ${allApiExchanges.length} exchanges after deduplication`);

      const mapExchange = (ex: GeckoExchange, existing?: Exchange) =>
        new Exchange({
          ...existing,
          name: ex.name,
          slug: (ex as any).id,
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

      // Step 2: Further ensure we're not trying to insert duplicates by checking against DB data
      const exchangesToSync = allApiExchanges.map((ex) => {
        const existing = existingExchanges.find((e) => e.slug === ex.id);
        return mapExchange(ex, existing);
      });

      // Check for name collisions with existing exchanges
      const newExchanges = exchangesToSync
        .filter((ex) => !existingExchanges.find((e) => e.slug === ex.slug))
        .filter((ex, idx, self) => {
          // Ensure no duplicate names in the batch of new exchanges
          return self.findIndex((e) => e.name === ex.name) === idx;
        });

      const updatedExchanges = exchangesToSync.filter((ex) => existingExchanges.find((e) => e.slug === ex.slug));

      const missingExchanges = existingExchanges
        .filter((existing) => !allApiExchanges.find((api) => api.id === existing.slug))
        .map((ex) => ex.id);

      if (newExchanges.length > 0) {
        try {
          const insertedExchanges = await this.exchange.createMany(newExchanges);
          this.logger.log(
            `Added ${insertedExchanges.length} exchanges: ${insertedExchanges.map(({ name }) => name).join(', ')}`
          );
        } catch (err) {
          this.logger.error(`Error inserting new exchanges: ${err.message}`);
          // Continue with updates even if inserts fail
        }
      }

      if (updatedExchanges.length > 0) {
        try {
          await this.exchange.updateMany(updatedExchanges);
          this.logger.log(`Updated ${updatedExchanges.length} exchanges`);
        } catch (err) {
          this.logger.error(`Error updating exchanges: ${err.message}`);
        }
      }

      if (missingExchanges.length > 0) {
        try {
          await this.exchange.removeMany(missingExchanges);
          this.logger.log(`Removed ${missingExchanges.length} obsolete exchanges`);
        } catch (err) {
          this.logger.error(`Error removing exchanges: ${err.message}`);
        }
      }
    } catch (e) {
      this.logger.error('Exchange sync failed:', e);
    } finally {
      this.logger.log('Exchange Sync Complete');
    }
  }
}
