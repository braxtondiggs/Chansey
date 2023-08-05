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
  private readonly supported_exchanges = ['binance_us']; //, 'coinbase_pro', 'gemini', 'kraken', 'kucoin'];

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
      const coins = await this.portfolio.getPortfolioCoins();
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
    name: 'scrape coin exchanges'
  }) // every monday at 12:45:00 AM
  async exchanges() {
    try {
      this.logger.log('Exchange Cron');
      for (const exchange_slug of this.supported_exchanges) {
        const data = await this.gecko.exchangeId(exchange_slug);
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
      }
    } catch (e) {
      this.logger.error(e);
    }
  }

  @Cron('40 0 * * MON', {
    name: 'scrape exchange tickers'
  }) // every monday at 12:40:00 AM
  async tickers() {
    try {
      this.logger.log('Ticker Cron');
      const coins = await this.coin.getCoins();
      const exchanges = await this.exchange.getExchanges();
      for (const exchange_slug of this.supported_exchanges) {
        let page = 1;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { tickers } = await this.gecko.exchangeIdTickers({ id: exchange_slug, page });
          if (tickers.length === 0) break;
          for (const ticker of tickers) {
            const base_coin = coins.find((coin) => coin.slug.toLowerCase() === ticker.coin_id.toLowerCase());
            const target_coin = coins.find(({ slug }) => slug.toLowerCase() === ticker?.target_coin_id?.toLowerCase());
            const exchange = exchanges.find(
              ({ slug }) => slug.toLowerCase() === ticker?.market?.identifier?.toLowerCase()
            );
            if (!base_coin || !target_coin || !exchange) continue;

            const tickerCoin = await this.ticker.getTickerByCoin(base_coin.id, target_coin.id, exchange.id);
            /* if (ticker.is_anomaly || ticker.is_stale) {
              if (tickerCoin?.id) this.ticker.deleteTicker(tickerCoin?.id);
              continue;
            }*/
            await this.ticker.saveTicker({
              coin: base_coin,
              exchange,
              fetchAt: ticker.last_fetch_at,
              id: tickerCoin?.id,
              lastTraded: ticker.last_traded_at,
              spreadPercentage: ticker.bid_ask_spread_percentage,
              target: target_coin,
              tradeUrl: ticker.trade_url,
              volume: ticker.volume
            });
          }
          this.logger.log(`Page ${page} of ${exchange_slug} tickers scraped`);
          await new Promise((r) => setTimeout(r, 2000));
          page++;
        }
      }
    } catch (e) {
      this.logger.error(e);
    }
  }

  @Cron('0 23 * * *', {
    name: 'Update coin detailed'
  }) // every day at 11:00:00 PM
  async coinDetailed() {
    this.logger.log('Detailed Coins Cron');
    const coins = await this.portfolio.getPortfolioCoins();

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
