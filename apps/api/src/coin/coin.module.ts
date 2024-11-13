import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CoinController } from './coin.controller';
import { Coin } from './coin.entity';
import { CoinService } from './coin.service';
import { CoinTask } from './coin.task';
import { CoinPairs } from './pairs/pairs.entity';
import { CoinPairsService } from './pairs/pairs.service';
import { BinanceService } from '../exchange/binance/binance.service';

@Module({
  controllers: [CoinController],
  exports: [CoinService],
  imports: [ConfigModule, TypeOrmModule.forFeature([Coin, CoinPairs])],
  providers: [CoinService, CoinTask, BinanceService, CoinPairsService]
})
export class CoinModule {}
