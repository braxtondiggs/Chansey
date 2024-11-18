import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CoinGeckoClient } from 'coingecko-api-v3';

import { CoinService } from '../coin/coin.service';
import { PortfolioService } from '../portfolio/portfolio.service';
import { PriceService } from '../price/price.service';

@Injectable()
export class TaskService {
  private readonly gecko = new CoinGeckoClient({ timeout: 10000, autoRetry: true });
  private readonly logger = new Logger(TaskService.name);
  private readonly supported_exchanges = ['binance_us']; //, 'coinbase_pro', 'gemini', 'kraken', 'kucoin'];

  constructor(
    private readonly coin: CoinService,
    private readonly portfolio: PortfolioService,
    private readonly price: PriceService
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, {
    name: 'scrape coin prices'
    // disabled: process.env.NODE_ENV === 'development'
  })
  async prices() {
    try {
      this.logger.log('New Price Cron');
      const coins = await this.portfolio.getPortfolioCoins();
      const ids = coins.map(({ slug }) => slug).join(',');
      const prices = await this.gecko.simplePrice({
        ids,
        vs_currencies: 'usd',
        include_24hr_vol: true,
        include_market_cap: true,
        include_last_updated_at: true
      });

      const data = Object.keys(coins).map((key) => ({
        price: prices[coins[key].slug].usd,
        marketCap: prices[coins[key].slug].usd_market_cap,
        totalVolume: prices[coins[key].slug].usd_24h_vol,
        geckoLastUpdatedAt: new Date(prices[coins[key].slug].last_updated_at * 1000),
        coin: coins[key].id,
        coinId: coins[key].id
      }));

      await Promise.all(data.map((price) => this.price.create(price)));
    } catch (e) {
      this.logger.error(e);
    }
  }
}
