import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cache } from 'cache-manager';
import { CoinGeckoClient } from 'coingecko-api-v3';
import * as dayjs from 'dayjs';
import * as customParseFormat from 'dayjs/plugin/customParseFormat';
import { Between, In, Repository } from 'typeorm';

import { CreatePriceDto } from './dto/create-price.dto';
import { Price, PriceSummaryByDay, PriceSummaryByHour } from './price.entity';
import { Coin } from '../coin/coin.entity';
import { TestnetSummary as PriceRange, TestnetSummaryDuration as PriceRangeTime } from '../order/testnet/dto';
import { PortfolioService } from '../portfolio/portfolio.service';

type PriceAggregation = {
  avg: number;
  date: Date;
  high: number;
  low: number;
  coin: string;
};

type PriceMap = { [key: string]: PriceAggregation[] };

@Injectable()
export class PriceService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PriceService.name);
  private readonly gecko = new CoinGeckoClient({
    timeout: 10000,
    autoRetry: true
  });
  private readonly CACHE_TTL = 3600; // 1 hour

  constructor(
    @InjectRepository(Price) private readonly price: Repository<Price>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
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

  private async getCachedPrices(key: string, fetchFn: () => Promise<Price[]>): Promise<Price[]> {
    const cached = await this.cacheManager.get<Price[]>(key);
    if (cached) return cached;

    const prices = await fetchFn();
    await this.cacheManager.set(key, prices, this.CACHE_TTL);
    return prices;
  }

  async findAll(coins: string[] | string, range = PriceRange['all']): Promise<Price[]> {
    const cacheKey = `prices_${Array.isArray(coins) ? coins.join('_') : coins}_${range}`;
    return this.getCachedPrices(cacheKey, async () => {
      const coin = Array.isArray(coins) ? { id: In(coins) } : { id: coins };
      const time = PriceRangeTime[range];
      return this.price.find({
        where: {
          coin,
          geckoLastUpdatedAt: Between(new Date(Date.now() - time), new Date())
        },
        order: { geckoLastUpdatedAt: 'ASC' }
      });
    });
  }

  private aggregatePrices(prices: Price[], groupingFn: (price: Price) => string): PriceMap {
    const groupedPrices = prices.reduce((acc, price) => {
      const key = `${groupingFn(price)}-${price.coinId}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(price);
      return acc;
    }, {} as Record<string, Price[]>);

    return Object.entries(groupedPrices)
      .map(([_, prices]) => {
        const [first] = prices;
        return {
          date: first.geckoLastUpdatedAt,
          high: Math.max(...prices.map((p) => p.price)),
          low: Math.min(...prices.map((p) => p.price)),
          avg: +(prices.reduce((sum, p) => sum + p.price, 0) / prices.length).toFixed(2),
          coin: first.coinId
        };
      })
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .reduce((acc, price) => {
        if (!acc[price.coin]) acc[price.coin] = [];
        acc[price.coin].push(price);
        return acc;
      }, {} as PriceMap);
  }

  async findAllByDay(coins: string[] | string, range = PriceRange['all']): Promise<PriceSummaryByDay> {
    const prices = await this.findAll(coins, range);
    return this.aggregatePrices(prices, (price) => price.geckoLastUpdatedAt.toISOString().split('T')[0]);
  }

  async findAllByHour(coins: string[] | string, range = PriceRange['all']): Promise<PriceSummaryByHour> {
    const prices = await this.findAll(coins, range);
    return this.aggregatePrices(
      prices,
      (price) => `${price.geckoLastUpdatedAt.toISOString().split('T')[0]}-${price.geckoLastUpdatedAt.getHours()}`
    );
  }

  async backFillPrices(coin: Coin) {
    try {
      const lastPrice = await this.price.findOne({
        where: { coin: { id: coin.id } },
        order: { geckoLastUpdatedAt: 'DESC' }
      });

      if (!lastPrice || !dayjs(lastPrice.geckoLastUpdatedAt).isBefore(dayjs().subtract(1, 'day'))) {
        return;
      }

      const { prices, market_caps, total_volumes } = await this.gecko.coinIdMarketChartRange({
        id: coin.slug,
        vs_currency: 'usd',
        from: dayjs(lastPrice.geckoLastUpdatedAt).unix(),
        to: dayjs().unix()
      });

      await Promise.all(
        prices.map(async ([date, price]) => {
          const marketCap = market_caps.find(([d]) => d === date)?.[1];
          const totalVolume = total_volumes.find(([d]) => d === date)?.[1];

          if (!marketCap || !totalVolume) return;

          const geckoLastUpdatedAt = dayjs(date).toDate();
          await this.create({
            coin,
            coinId: coin.id,
            geckoLastUpdatedAt,
            marketCap,
            price,
            totalVolume
          });
          this.logger.log(`Backfilled price for ${coin.name} on ${dayjs(date).toString()}`);
        })
      );
    } catch (error) {
      this.logger.error(`Failed to backfill prices for ${coin.name}: ${error.message}`);
    }
  }

  async getLatestPrice(coins: string[] | string): Promise<Price[] | Price> {
    const coinIds = Array.isArray(coins) ? coins : [coins];
    const latestPrices = await Promise.all(
      coinIds.map((coinId) =>
        this.price.findOne({
          where: { coinId },
          order: { geckoLastUpdatedAt: 'DESC' }
        })
      )
    );
    if (latestPrices.length === 1) return latestPrices[0];
    return latestPrices.filter((price) => price);
  }
}
