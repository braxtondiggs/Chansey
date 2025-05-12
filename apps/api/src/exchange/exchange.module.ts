import { HttpModule } from '@nestjs/axios';
import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BinanceUSService } from './binance/binance-us.service';
import { CoinbaseService } from './coinbase/coinbase.service';
import { ExchangeKeyModule } from './exchange-key/exchange-key.module';
import { ExchangeController } from './exchange.controller';
import { Exchange } from './exchange.entity';
import { ExchangeService } from './exchange.service';
import { ExchangeTask } from './exchange.task';

import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';

@Module({
  controllers: [ExchangeController],
  imports: [ConfigModule, HttpModule, TypeOrmModule.forFeature([Coin, Exchange]), forwardRef(() => ExchangeKeyModule)],
  providers: [BinanceUSService, CoinbaseService, CoinService, ExchangeService, ExchangeTask],
  exports: [ExchangeService, BinanceUSService, CoinbaseService]
})
export class ExchangeModule {}
