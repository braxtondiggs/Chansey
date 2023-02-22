import { EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CoinGeckoClient } from 'coingecko-api-v3';

import { Coin } from './entities/coin.entity';


@Injectable()
export class TasksService {
  private readonly gecko = new CoinGeckoClient({ timeout: 10000, autoRetry: true });
  private readonly logger = new Logger(TasksService.name);

  constructor(@InjectRepository(Coin) private readonly coin: EntityRepository<Coin>) { }

  @Cron('0 0 0 1,15 * *') // 1st and 15th day of the month at 12:00:00 AM
  async getCoinList() {
    this.logger.debug('Called when the current second is 45');
    const coins = this.gecko.coinList({ include_platform: false });

  }
}
