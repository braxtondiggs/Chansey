import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CoinGeckoClient } from 'coingecko-api-v3';
import { In, IsNull, Not, Repository } from 'typeorm';

import { Coin, CoinRelations } from './coin.entity';
import { CreateCoinDto, UpdateCoinDto } from './dto/';
import { BinanceService } from '../exchange/binance/binance.service';
import { User } from '../users/users.entity';
import { NotFoundCustomException } from '../utils/filters/not-found.exception';

interface HistoricalDataPoint {
  timestamp: number;
  price: number;
  volume: number;
  marketCap?: number;
}

@Injectable()
export class CoinService {
  private readonly gecko = new CoinGeckoClient({ timeout: 10000, autoRetry: true });

  constructor(
    @InjectRepository(Coin) private readonly coin: Repository<Coin>,
    private readonly binance: BinanceService
  ) {}

  async getCoins() {
    const coins = await this.coin.find();
    return coins.map((coin) => {
      Object.keys(coin).forEach((key) => coin[key] === null && delete coin[key]);
      return coin;
    });
  }

  async getCoinById(coinId: string, relations?: CoinRelations[]): Promise<Coin> {
    const coin = await this.coin.findOne({ where: { id: coinId }, relations });
    if (!coin) throw new NotFoundCustomException('Coin', { id: coinId });
    Object.keys(coin).forEach((key) => coin[key] === null && delete coin[key]);
    return coin;
  }

  async getCoinBySymbol(symbol: string, relations?: CoinRelations[]): Promise<Coin> {
    const coin = await this.coin.findOne({
      where: { symbol: symbol.toLowerCase() },
      relations
    });
    if (!coin) throw new NotFoundCustomException('Coin', { symbol });
    Object.keys(coin).forEach((key) => coin[key] === null && delete coin[key]);
    return coin;
  }

  async create(Coin: CreateCoinDto): Promise<Coin> {
    const coin = await this.coin.findOne({ where: { slug: Coin.slug } });
    return coin ?? ((await this.coin.insert(Coin)).generatedMaps[0] as Coin);
  }

  async createMany(coins: CreateCoinDto[]): Promise<Coin[]> {
    const existingCoins = await this.coin.find({
      where: coins.map((coin) => ({ slug: coin.slug }))
    });

    const newCoins = coins.filter((coin) => !existingCoins.find((existing) => existing.slug === coin.slug));

    if (newCoins.length === 0) return [];

    const result = await this.coin.insert(newCoins);
    return result.generatedMaps as Coin[];
  }

  async update(coinId: string, coin: UpdateCoinDto) {
    const data = await this.getCoinById(coinId);
    if (!data) new NotFoundCustomException('Coin', { id: coinId });
    return await this.coin.save(new Coin({ ...data, ...coin }));
  }

  async clearRank() {
    await this.coin.update({}, { geckoRank: null });
  }

  async remove(coinId: string) {
    const response = await this.coin.delete(coinId);
    if (!response.affected) new NotFoundCustomException('Coin', { id: coinId });
    return response;
  }

  async removeMany(coinIds: string[]): Promise<void> {
    await this.coin.delete({ id: In(coinIds) });
  }

  async getCoinHistoricalData(coinId: string): Promise<HistoricalDataPoint[]> {
    const coin = await this.getCoinById(coinId);

    try {
      const geckoData = await this.gecko.coinIdMarketChart({
        id: coin.slug,
        vs_currency: 'usd',
        days: 365, // !NOTE: Max value w/o paying money
        interval: 'daily'
      });

      if (geckoData?.prices?.length > 0) {
        return geckoData.prices.map((point: [number, number], index: number) => ({
          timestamp: point[0],
          price: point[1],
          volume: geckoData.total_volumes[index]?.[1] || 0,
          marketCap: geckoData.market_caps[index]?.[1] || 0
        }));
      }
    } catch (error) {
      throw new NotFoundCustomException('Historical data', {
        id: coinId,
        message: error
      });
    }
  }

  async getCoinBySlug(slug: string) {
    return this.coin.findOne({ where: { slug } });
  }

  async getCoinsByRiskLevel({ risk }: User, take = 10) {
    const { level: riskLevel } = risk;

    if (riskLevel === 1) {
      return await this.coin.find({
        where: {
          totalVolume: Not(IsNull())
        },
        order: {
          totalVolume: 'DESC'
        },
        take
      });
    }

    if (riskLevel === 5) {
      return await this.coin.find({
        where: {
          geckoRank: Not(IsNull())
        },
        order: {
          geckoRank: 'ASC'
        },
        take
      });
    }

    // For risk levels 2-4
    return await this.coin
      .createQueryBuilder('coin')
      .where('coin.totalVolume IS NOT NULL')
      .andWhere('coin.geckoRank IS NOT NULL')
      .andWhere('coin.marketCap IS NOT NULL')
      .orderBy(
        `(
          COALESCE(LN(coin."totalVolume" + 1), 0) * ${(5 - riskLevel) / 4} +
          COALESCE(LN(coin."marketCap" + 1), 0) * ${(5 - riskLevel) / 4} -
          COALESCE(coin."geckoRank", 0) * ${(riskLevel - 1) / 4}
        )`,
        'DESC'
      )
      .take(take)
      .getMany();
  }
}
