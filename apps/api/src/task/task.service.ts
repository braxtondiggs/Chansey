import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CoinGeckoClient } from 'coingecko-api-v3';
import { firstValueFrom } from 'rxjs';

import { CategoryService } from '../category/category.service';
import { CoinService } from '../coin/coin.service';
import { Exchange } from '../exchange/exchange.entity';
import { ExchangeService } from '../exchange/exchange.service';
import { TickerService } from '../exchange/ticker/ticker.service';
import { PortfolioService } from '../portfolio/portfolio.service';
import { PriceService } from '../price/price.service';

@Injectable()
export class TaskService {
  private readonly gecko = new CoinGeckoClient({ timeout: 10000, autoRetry: true });
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private readonly category: CategoryService,
    private readonly coin: CoinService,
    private readonly exchange: ExchangeService,
    private readonly http: HttpService,
    private readonly portfolio: PortfolioService,
    private readonly price: PriceService,
    private readonly ticker: TickerService
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
      const prices = await this.gecko.simplePrice({
        ids,
        vs_currencies: 'usd',
        include_market_cap: true,
        include_last_updated_at: true
      });

      const data = Object.keys(coins).map((key) => ({
        price: prices[coins[key].slug].usd,
        marketCap: prices[coins[key].slug].usd_market_cap,
        geckoLastUpdatedAt: new Date(prices[coins[key].slug].last_updated_at * 1000),
        coin: coins[key].id
      }));

      await Promise.all(data.map((price) => this.price.create(price)));
    } catch (e) {
      this.logger.error(e);
    }
  }

  @Cron('45 0 * * MON', {
    name: 'scrape coin exchanges and tickers',
    disabled: process.env.NODE_ENV === 'development'
  }) // every monday at 12:45:00 AM
  async exchanges() {
    try {
      const supported_exchanges = ['binance_us']; //, 'coinbase_pro', 'gemini', 'kraken', 'kucoin'];
      for (const exchange_slug of supported_exchanges) {
        const data = await this.gecko.exchangeId(exchange_slug);
        const coins = await this.coin.getCoins();
        const exchanges = await this.exchange.getExchanges();
        const { tickers } = data;

        for (const ticker of tickers) {
          await this.exchange.updateExchange(
            exchange_slug,
            new Exchange({
              name: data.name,
              slug: exchange_slug,
              url: data.url,
              image: data.image,
              country: data.country,
              yearEstablished: data.year_established,
              trustScore: data.trust_score,
              trustScoreRank: data.trust_score_rank,
              tradeVolume24HBtc: data.trade_volume_24h_btc,
              tradeVolume24HNormalized: data.trade_volume_24h_btc_normalized,
              facebook: data.facebook_url,
              reddit: data.reddit_url,
              telegram: data.telegram_url,
              twitter: data.twitter_handle,
              otherUrl1: data.other_url_1,
              otherUrl2: data.other_url_2,
              centralized: data.centralized
            })
          );
          if (ticker.is_anomaly || ticker.is_stale) {
            const { id = null } = await this.ticker.getTickerByCoin(
              ticker.coin_id,
              ticker.target_coin_id,
              ticker.market.identifier
            );
            if (id) this.ticker.deleteTicker(id);
            return;
          }
          const base_coin = coins.find((coin) => coin.symbol === ticker.base.toLowerCase());
          const target_coin = coins.find((coin) => coin.symbol === ticker.target.toLowerCase());
          const exchange = exchanges.find((ex) => ex.slug === ticker.market.identifier.toLowerCase());
          if (!base_coin || !target_coin || !exchange) return;
          await this.ticker.saveTicker({
            coin: base_coin,
            target: target_coin,
            exchange,
            volume: ticker.volume,
            lastTraded: ticker.last_traded_at,
            fetchAt: ticker.last_fetch_at,
            tradeUrl: ticker.trade_url,
            spreadPercentage: ticker.bid_ask_spread_percentage
          });
        }
      }
    } catch (e) {
      this.logger.error(e);
    }
  }

  @Cron('0 23 * * *', {
    name: 'scrape coin exchanges and tickers',
    disabled: process.env.NODE_ENV === 'development'
  }) // every day at 11:00:00 PM
  async coinDetailed() {
    this.logger.log('Detailed Coins Cron');
    const portfolio = await this.portfolio.getPortfolio();
    const coins = [...new Set(portfolio.map(({ coin }) => coin))];

    for (const { id, slug } of coins) {
      const coin = await this.gecko.coinId({ id: slug, localization: false, tickers: false });

      this.coin.update(id, {
        description: coin.description.en,
        image: coin.image.large || coin.image.small || coin.image.thumb,
        genesis: coin.genesis_date,
        totalSupply: coin.market_data.total_supply,
        circulatingSupply: coin.market_data.circulating_supply,
        maxSupply: coin.market_data.max_supply,
        marketRank: coin.market_cap_rank,
        geckoRank: coin.coingecko_rank,
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
    }
  }
  catch(e) {
    this.logger.error(e);
  }
}
