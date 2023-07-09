import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Binance, { Binance as BinanceClient } from 'binance-api-node';
import { instanceToPlain } from 'class-transformer';
import { Repository } from 'typeorm';

import { UpdateUserDto } from './dto';
import User from './users.entity';

@Injectable()
export default class UsersService {
  binance: BinanceClient;

  constructor(
    @InjectRepository(User)
    private readonly user: Repository<User>
  ) {}

  async create(id: string) {
    return (await this.user.insert({ id })).generatedMaps[0] as User;
  }

  async update(dto: UpdateUserDto, user: User) {
    const data = this.user.create({ ...user, ...dto });
    return await this.user.update(user.id, data);
  }

  async getById(id: string) {
    return await this.user.findOneByOrFail({ id });
  }

  getBinance(user: User) {
    if (this.binance) return this.binance;
    user = instanceToPlain(new User(user)) as User;
    this.binance = Binance({
      apiKey: user.binanceAPIKey,
      apiSecret: user.binanceSecretKey,
      httpBase: 'https://api.binance.us'
      // httpFuturesBase: 'https://fapi.binance.us'
    });
    return this.binance;
  }

  async getBinanceInfo(user: User) {
    const binance = this.getBinance(user);
    return await binance.accountInfo();
  }
}
