import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Coin, CoinRelations } from './coin.entity';
import { CreateCoinDto, UpdateCoinDto } from './dto/';
import { BinanceService } from '../exchange/binance/binance.service';
import { NotFoundCustomException } from '../utils/filters/not-found.exception';

@Injectable()
export class CoinService {
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

  async remove(coinId: string) {
    const response = await this.coin.delete(coinId);
    if (!response.affected) new NotFoundCustomException('Coin', { id: coinId });
    return response;
  }

  async removeMany(coinIds: string[]): Promise<void> {
    await this.coin.delete({ id: In(coinIds) });
  }

  async getCoinHistoricalData(coinId: string) {
    const _coin = await this.getCoinById(coinId);
    return 'Not Working'; // TODO: Add historical data
  }

  async getCoinBySlug(slug: string) {
    return this.coin.findOne({ where: { slug } });
  }
}
