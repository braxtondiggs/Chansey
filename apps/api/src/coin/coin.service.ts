import { EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CoinGeckoClient } from 'coingecko-api-v3';

import { Coin } from './coin.entity';
import { CreateCoinDto } from './dto/create-coin.dto';

@Injectable()
export class CoinService {
  private readonly gecko = new CoinGeckoClient({ timeout: 10000, autoRetry: true });
  private readonly logger = new Logger(CoinService.name);

  constructor(@InjectRepository(Coin) private readonly coin: EntityRepository<Coin>) {}

  @Cron('0 0 0 1,15 * *') // 1st and 15th day of the month at 12:00:00 AM
  async scrapeCoins() {
    try {
      this.logger.log('New Coins Cron');
      const [coins, oldCoins] = await Promise.all([
        this.gecko.coinList({ include_platform: false }),
        this.coin.getCoins()
      ]);
      const newCoins = coins.filter((coin) => !oldCoins.find((oldCoin) => oldCoin.slug === coin.id));
      newCoins.forEach(({ id, name }) => this.create({ slug: id, name }));
      await this.coin.flush();
      if (newCoins.length > 0) this.logger.log(`New Coins: ${newCoins.map(({ name }) => name).join(', ')}`);
    } catch (e) {
      this.logger.error(e);
    } finally {
      this.logger.log('New Coins Cron Complete');
    }
  }

  async getCoins(): Promise<Coin[]> {
    return await this.coin.findAll();
  }

  async getCoinById(id: string): Promise<Coin> {
    return await this.coin.findOne({ id });
  }

  private async create(dto: CreateCoinDto, flush = false): Promise<Coin> {
    const coin = this.coin.create(new Coin(dto.slug, dto.name));
    this.coin.persist(coin);
    if (flush) await this.coin.flush();
    return coin;
  }
}
