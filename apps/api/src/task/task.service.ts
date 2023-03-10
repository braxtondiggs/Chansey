import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CoinGeckoClient } from 'coingecko-api-v3';
import { firstValueFrom } from 'rxjs';

import { CategoryService } from '../category/category.service';
import { CoinService } from '../coin/coin.service';
import { PortfolioService } from '../portfolio/portfolio.service';
import { PriceService } from '../price/price.service';

@Injectable()
export class TaskService {
  private readonly gecko = new CoinGeckoClient({ timeout: 10000, autoRetry: true });
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private readonly category: CategoryService,
    private readonly coin: CoinService,
    private readonly http: HttpService,
    private readonly portfolio: PortfolioService,
    private readonly price: PriceService
  ) {}

  @Cron('0 0 * * MON', {
    name: 'scrape coins'
  }) // every monday at 12:00:00 AM
  async coins() {
    try {
      this.logger.log('New Coins Cron');
      const [coins, oldCoins] = await Promise.all([
        this.gecko.coinList({ include_platform: false }),
        this.coin.getCoins()
      ]);
      const newCoins = coins.filter((coin) => !oldCoins.find((oldCoin) => oldCoin.slug === coin.id));
      await Promise.all(newCoins.map(({ id: slug, symbol, name }) => this.coin.create({ slug, symbol, name })));
      if (newCoins.length > 0) this.logger.log(`New Coins: ${newCoins.map(({ name }) => name).join(', ')}`);
    } catch (e) {
      this.logger.error(e);
    } finally {
      this.logger.log('New Coins Cron Complete');
    }
  }

  @Cron('30 0 * * MON', {
    name: 'scrape categories'
  }) // every monday at 12:30:00 AM
  async categories() {
    try {
      this.logger.log('New Category Cron');
      const [{ data: categories }, oldCategories] = await Promise.all([
        firstValueFrom(this.http.get('https://api.coingecko.com/api/v3/coins/categories/list')) as Promise<any>,
        this.category.getCategories()
      ]);
      const newCategories = categories
        .map((c) => ({ slug: c.category_id, symbol: c.symbol, name: c.name }))
        .filter((category) => !oldCategories.find((oldCategory) => oldCategory.slug === category.slug));
      await Promise.all(newCategories.map((category) => this.category.create(category)));
      if (newCategories.length > 0)
        this.logger.log(`New Categories: ${newCategories.map(({ name }) => name).join(', ')}`);
    } catch (e) {
      this.logger.error(e);
    } finally {
      this.logger.log('New Category Cron Complete');
    }
  }

  @Cron('* * * * *', {
    name: 'scrape coin prices',
    disabled: process.env.NODE_ENV === 'development'
  }) // every minute
  async prices() {
    try {
      this.logger.log('New Price Cron');
      const portfolio = await this.portfolio.getPortfolio();
      const coins = [...new Set(portfolio.map(({ coin }) => coin))];
      const ids = coins.map(({ slug }) => slug).join(',');
      const prices = await this.gecko.simplePrice({ ids, vs_currencies: 'usd' });

      const data = Object.keys(coins).map((key) => ({
        price: prices[coins[key].slug].usd,
        coin: coins[key].id
      }));

      await Promise.all(data.map((price) => this.price.create(price)));
    } catch (e) {
      this.logger.error(e);
    }
  }
}
