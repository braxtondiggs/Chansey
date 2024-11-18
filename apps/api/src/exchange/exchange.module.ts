import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BinanceService } from './binance/binance.service';
import { ExchangeController } from './exchange.controller';
import { Exchange } from './exchange.entity';
import { ExchangeService } from './exchange.service';
import { ExchangeTask } from './exchange.task';
import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';

@Module({
  controllers: [ExchangeController],
  imports: [ConfigModule, TypeOrmModule.forFeature([Coin, Exchange])],
  providers: [BinanceService, CoinService, ExchangeService, ExchangeTask]
})
export class ExchangeModule {}
