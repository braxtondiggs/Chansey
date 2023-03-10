import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';

import { Coin } from './coin.entity';
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

  async getCoinById(coinId: string): Promise<Coin> {
    const coin = await this.coin.findOneBy({ id: coinId });
    Object.keys(coin).forEach((key) => coin[key] === null && delete coin[key]);
    return coin;
  }

  async create(Coin: CreateCoinDto): Promise<Coin> {
    const coin = await this.coin.findOne({ where: { name: ILike(`%${Coin.name}%`) } });
    return coin ?? ((await this.coin.insert(Coin)).generatedMaps[0] as Coin);
  }

  async update(coin: UpdateCoinDto) {
    return await this.coin.save(coin);
  }

  async remove(coinId: string) {
    return await this.coin.delete(coinId);
  }
}
