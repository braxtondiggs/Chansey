import { EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { Injectable } from '@nestjs/common';

import { Coin } from './coin.entity';
import { CreateCoinDto } from './dto/create-coin.dto';

@Injectable()
export class CoinService {
  constructor(@InjectRepository(Coin) private readonly coin: EntityRepository<Coin>) {}

  async getCoins(): Promise<Coin[]> {
    return await this.coin.findAll();
  }

  async getCoinById(id: string): Promise<Coin> {
    return await this.coin.findOne({ id });
  }

  async create(dto: CreateCoinDto, flush = false): Promise<Coin> {
    const coin = this.coin.create(new Coin(dto.slug, dto.symbol, dto.name));
    this.coin.persist(coin);
    if (flush) await this.coin.flush();
    return coin;
  }

  async createMany(dto: CreateCoinDto[]): Promise<Coin[]> {
    const promise = dto.map((c) => this.create(c));
    const coins = await Promise.all(promise);
    await this.coin.flush();
    return coins;
  }
}
