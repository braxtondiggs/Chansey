import { Controller, Get, Param } from '@nestjs/common';

import { Coin } from './coin.entity';
import { CoinService } from './coin.service';
import FindOneParams from '../utils/findOneParams';

@Controller('coin')
export class CoinController {
  constructor(private readonly coin: CoinService) {}

  @Get()
  async getCoins(): Promise<Coin[]> {
    return this.coin.getCoins();
  }

  @Get(':id')
  getCoinById(@Param() { id }: FindOneParams): Promise<Coin> {
    return this.coin.getCoinById(id);
  }
}
