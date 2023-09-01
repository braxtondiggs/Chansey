import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CoinGeckoClient } from 'coingecko-api-v3';
import * as dayjs from 'dayjs';
import * as customParseFormat from 'dayjs/plugin/customParseFormat';
import { Between, In, Repository } from 'typeorm';

import { CreatePriceDto } from './dto/create-price.dto';
import { Price, PriceSummaryByDay, PriceSummaryByHour } from './price.entity';
import { Coin } from '../coin/coin.entity';
import { TestnetSummary as PriceRange, TestnetSummaryDuration as PriceRangeTime } from '../order/testnet/dto';
import { PortfolioService } from '../portfolio/portfolio.service';

@Injectable()
export class PriceService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PriceService.name);
  private readonly gecko = new CoinGeckoClient({ timeout: 10000, autoRetry: true });
  constructor(
    @InjectRepository(Price) private readonly price: Repository<Price>,
    private readonly portfolio: PortfolioService
  ) {
    dayjs.extend(customParseFormat);
  }

  async onApplicationBootstrap() {
    if (process.env.NODE_ENV !== 'production') return;
    const coins = await this.portfolio.getPortfolioCoins();
    for (const coin of coins) {
      await this.backFillPrices(coin);
    }
  }

  async create(Price: CreatePriceDto) {
    return (await this.price.insert(Price)).generatedMaps[0];
  }

  async latest(coin: Coin): Promise<Price> {
    return await this.price.findOne({
      where: {
        coin: {
          id: coin.id
        }
      },
      order: {
        geckoLastUpdatedAt: 'DESC'
      }
    });
  }

  async findAll(coins: string[] | string, range = PriceRange['all']): Promise<Price[]> {
    const coin = Array.isArray(coins) ? { id: In(coins) } : { id: coins };
    const time = PriceRangeTime[range];
    return await this.price.find({
      where: {
        coin,
        geckoLastUpdatedAt: Between(new Date(Date.now() - time), new Date())
      },
      order: {
        geckoLastUpdatedAt: 'ASC'
      }
    });
  }

  async findAllByDay(coins: string[] | string, range = PriceRange['all']): Promise<PriceSummaryByDay> {
    const prices = await this.findAll(coins, range);
    const dayPrices = prices.reduce((acc, price) => {
      const date = price.geckoLastUpdatedAt.toISOString().split('T')[0];
      const key = `${date}-${price.coinId}`;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(price);
      return acc;
    }, {});
    return Object.keys(dayPrices)
      .map((key) => {
        const dayPrice = dayPrices[key];
        const date = dayPrice[0].geckoLastUpdatedAt;
        const high = Math.max(...dayPrice.map(({ price }) => price));
        const low = Math.min(...dayPrice.map(({ price }) => price));
        const avg = +(dayPrice.reduce((acc, { price }) => acc + price, 0) / dayPrice.length).toFixed(2);
        const coin = dayPrice[0].coinId;
        return { avg, date, high, low, coin };
      })
      .reduce((acc, price) => {
        if (!acc[price.coin]) {
          acc[price.coin] = [];
        }
        acc[price.coin].push(price);
        return acc;
      }, {});
  }

  async findAllByHour(coins: string[] | string, range = PriceRange['all']): Promise<PriceSummaryByHour> {
    const prices = await this.findAll(coins, range);
    const hourPrices = prices.reduce((acc, price) => {
      const date = price.geckoLastUpdatedAt.toISOString().split('T')[0];
      const hour = price.geckoLastUpdatedAt.getHours();
      const key = `${date}-${hour}-${price.coinId}`;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(price);
      return acc;
    }, {});
    return Object.keys(hourPrices)
      .map((key) => {
        const hourPrice = hourPrices[key];
        const date = hourPrice[0].geckoLastUpdatedAt;
        const high = Math.max(...hourPrice.map(({ price }) => price));
        const low = Math.min(...hourPrice.map(({ price }) => price));
        const avg = +(hourPrice.reduce((acc, { price }) => acc + price, 0) / hourPrice.length).toFixed(2);
        const coin = hourPrice[0].coinId;
        return { avg, date, high, low, coin };
      })
      .reduce((acc, price) => {
        if (!acc[price.coin]) {
          acc[price.coin] = [];
        }
        acc[price.coin].push(price);
        return acc;
      }, {});
  }

  async backFillPrices(coin: Coin) {
    const lastPrice = await this.price.findOne({
      order: {
        geckoLastUpdatedAt: 'DESC'
      },
      where: {
        coin: {
          id: coin.id
        }
      }
    });
    if (lastPrice && dayjs(lastPrice.geckoLastUpdatedAt).isBefore(dayjs().subtract(1, 'day'))) {
      const { prices, market_caps, total_volumes } = await this.gecko.coinIdMarketChartRange({
        id: coin.slug,
        vs_currency: 'usd',
        from: dayjs(lastPrice.geckoLastUpdatedAt).unix(),
        to: dayjs().unix()
      });
      for (const [date, price] of prices) {
        const marketCap = market_caps.find(([d]) => d === date)[1];
        const totalVolume = total_volumes.find(([d]) => d === date)[1];
        const geckoLastUpdatedAt = dayjs(date).toDate();

        if (!marketCap || !totalVolume) continue;

        await this.create({
          price,
          marketCap,
          totalVolume,
          geckoLastUpdatedAt,
          coin
        });
        this.logger.log(`Backfilled price for ${coin.name} on ${dayjs(date).toString()}`);
      }
    }
  }
}
