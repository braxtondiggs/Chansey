import { Injectable, NotAcceptableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';

import { Coin, CoinRelations } from './coin.entity';
import { CreateCoinDto, UpdateCoinDto } from './dto/';

@Injectable()
export class CoinService {
  constructor(@InjectRepository(Coin) private readonly coin: Repository<Coin>) {}

  async getCoins(): Promise<Coin[]> {
    const coins = await this.coin.find();
    return coins.map((coin) => {
      Object.keys(coin).forEach((key) => coin[key] === null && delete coin[key]);
      return coin;
    });
  }

  async getCoinById(coinId: string, relations?: CoinRelations[]): Promise<Coin> {
    const coin = await this.coin.findOne({ where: { id: coinId }, relations });
    if (!coin) throw new NotAcceptableException('Coin not found');
    Object.keys(coin).forEach((key) => coin[key] === null && delete coin[key]);
    return coin;
  }

  async getCoinBySymbol(symbol: string, relations?: CoinRelations[]): Promise<Coin> {
    const coin = await this.coin.findOne({
      where: { symbol: symbol.toLowerCase() },
      relations
    });
    if (!coin) throw new NotAcceptableException('Coin not found');
    Object.keys(coin).forEach((key) => coin[key] === null && delete coin[key]);
    return coin;
  }

  async create(Coin: CreateCoinDto): Promise<Coin> {
    const coin = await this.coin.findOne({ where: { name: ILike(`%${Coin.name}%`) } });
    return coin ?? ((await this.coin.insert(Coin)).generatedMaps[0] as Coin);
  }

  async update(coinId: string, coin: UpdateCoinDto) {
    const data = await this.getCoinById(coinId);
    return await this.coin.save(new Coin({ ...data, ...coin }));
  }

  async remove(coinId: string) {
    return await this.coin.delete(coinId);
  }
}
