import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CoinGeckoClient } from 'coingecko-api-v3';

import { CoinService } from './coin.service';
import { PortfolioService } from '../portfolio/portfolio.service';

@Injectable()
export class CoinTask {
  private readonly gecko = new CoinGeckoClient({ timeout: 10000, autoRetry: true });
  private readonly logger = new Logger(CoinTask.name);

  constructor(private readonly coin: CoinService, private readonly portfolio: PortfolioService) {}

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

  @Cron(CronExpression.EVERY_DAY_AT_11PM)
  async getCoinDetail() {
    try {
      this.logger.log('Starting Detailed Coins Update');

      this.coin.clearRank();

      const [trendingResponse, portfolioCoins] = await Promise.all([
        this.gecko.trending(),
        this.portfolio.getPortfolioCoins()
      ]);

      const allCoins = [...portfolioCoins];
      for (const coin of trendingResponse.coins) {
        if (!allCoins.find((existing) => existing.slug === coin.item.id)) {
          const dbCoin = await this.coin.getCoinBySlug(coin.item.id);
          if (dbCoin) allCoins.push({ ...dbCoin, geckoRank: coin.item.score });
        }
      }

      const batchSize = 10;
      for (let i = 0; i < allCoins.length; i += batchSize) {
        const batch = allCoins.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async ({ id, slug, symbol, geckoRank }) => {
            try {
              this.logger.debug(`Updating details for ${symbol} (${slug})`);
              const coin = await this.gecko.coinId({
                id: slug,
                localization: false,
                tickers: false
              });

              await this.coin.update(id, {
                description: coin.description.en,
                image: coin.image.large || coin.image.small || coin.image.thumb,
                genesis: coin.genesis_date,
                totalSupply: coin.market_data.total_supply,
                totalVolume: coin.market_data.total_volume.usd,
                circulatingSupply: coin.market_data.circulating_supply,
                maxSupply: coin.market_data.max_supply,
                marketRank: coin.market_cap_rank,
                marketCap: coin.market_data.market_cap.usd,
                geckoRank: coin.coingecko_rank ?? geckoRank ?? null,
                developerScore: coin.developer_score,
                communityScore: coin.community_score,
                liquidityScore: coin.liquidity_score,
                publicInterestScore: coin.public_interest_score,
                sentimentUp: coin.sentiment_votes_up_percentage,
                sentimentDown: coin.sentiment_votes_down_percentage,
                ath: coin.market_data.ath.usd,
                atl: coin.market_data.atl.usd,
                athDate: coin.market_data.ath_date.usd,
                atlDate: coin.market_data.atl_date.usd,
                athChange: coin.market_data.ath_change_percentage.usd,
                atlChange: coin.market_data.atl_change_percentage.usd,
                geckoLastUpdatedAt: coin.market_data.last_updated
              });
              this.logger.debug(`Successfully updated ${symbol}`);
            } catch (error) {
              this.logger.error(`Failed to update ${symbol}: ${error.message}`);
            }
          })
        );
        // Add a small delay between batches to avoid rate limiting
        if (i + batchSize < allCoins.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
      this.logger.log('Detailed Coins Update Complete');
    } catch (e) {
      this.logger.error('Failed to process coin details:', e);
    }
  }
}
