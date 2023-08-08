import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';

import { CreatePriceDto } from './dto/create-price.dto';
import { Price, PriceSummaryByDay, PriceSummaryByHour } from './price.entity';
import { TestnetSummary as PriceRange, TestnetSummaryDuration as PriceRangeTime } from '../order/testnet/dto';

@Injectable()
export class PriceService {
  constructor(@InjectRepository(Price) private readonly price: Repository<Price>) {}

  async create(Price: CreatePriceDto) {
    return (await this.price.insert(Price)).generatedMaps[0];
  }

  async findAll(coins: string[] | string, range = PriceRange['all']): Promise<Price[]> {
    const coin = Array.isArray(coins) ? { id: In(coins) } : { id: coins };
    const time = PriceRangeTime[range];
    return await this.price.find({
      where: {
        coin,
        createdAt: Between(new Date(Date.now() - time), new Date())
      },
      order: {
        createdAt: 'ASC'
      }
    });
  }

  async findAllByDay(coins: string[] | string, range = PriceRange['all']): Promise<PriceSummaryByDay> {
    const prices = await this.findAll(coins, range);
    const dayPrices = prices.reduce((acc, price) => {
      const date = price.createdAt.toISOString().split('T')[0];
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
        const date = dayPrice[0].createdAt;
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
      const date = price.createdAt.toISOString().split('T')[0];
      const hour = price.createdAt.getHours();
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
        const date = hourPrice[0].createdAt;
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
}
