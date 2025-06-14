import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Between, In, Repository } from 'typeorm';

import { CreatePriceDto } from './dto/create-price.dto';
import { Price, PriceSummaryByDay, PriceSummaryByHour } from './price.entity';

type PriceAggregation = {
  avg: number;
  date: Date;
  high: number;
  low: number;
  coin: string;
};

enum PriceRange {
  '30m' = '30m',
  '1h' = '1h',
  '6h' = '6h',
  '12h' = '12h',
  '1d' = '1d',
  '7d' = '7d',
  '14d' = '14d',
  '30d' = '30d',
  '90d' = '90d',
  '180d' = '180d',
  '1y' = '1y',
  '5y' = '5y',
  'all' = 'all'
}

enum PriceRangeTime {
  '30m' = 30 * 60 * 1000,
  '1h' = 60 * 60 * 1000,
  '6h' = 6 * 60 * 60 * 1000,
  '12h' = 12 * 60 * 60 * 1000,
  '1d' = 24 * 60 * 60 * 1000,
  '7d' = 7 * 24 * 60 * 60 * 1000,
  '14d' = 14 * 24 * 60 * 60 * 1000,
  '30d' = 30 * 24 * 60 * 60 * 1000,
  '90d' = 90 * 24 * 60 * 60 * 1000,
  '180d' = 180 * 24 * 60 * 60 * 1000,
  '1y' = 365 * 24 * 60 * 60 * 1000,
  '5y' = 5 * 365 * 24 * 60 * 60 * 1000,
  'all' = new Date().getTime() // NOTE: This is a special case, 1970-01-01
}

type PriceMap = { [key: string]: PriceAggregation[] };

@Injectable()
export class PriceService {
  constructor(@InjectRepository(Price) private readonly price: Repository<Price>) {}

  async create(Price: CreatePriceDto) {
    return (await this.price.insert(Price)).generatedMaps[0];
  }

  async createMany(prices: CreatePriceDto[]) {
    return await this.price.insert(prices);
  }

  private async getCachedPrices(key: string, fetchFn: () => Promise<Price[]>): Promise<Price[]> {
    const prices = await fetchFn();
    return prices;
  }

  async findAll(coins: string[] | string, range = 'all'): Promise<Price[]> {
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
    const groupedPrices = prices.reduce(
      (acc, price) => {
        const key = `${groupingFn(price)}-${price.coinId}`;
        if (!acc[key]) acc[key] = [];
        acc[key].push(price);
        return acc;
      },
      {} as Record<string, Price[]>
    );

    return Object.entries(groupedPrices)
      .map(([, prices]) => {
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

  async getPriceCount(): Promise<number> {
    return await this.price.count();
  }
}
