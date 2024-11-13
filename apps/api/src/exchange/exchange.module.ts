import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BinanceService } from './binance/binance.service';
import { ExchangeController } from './exchange.controller';
import { Exchange } from './exchange.entity';
import { ExchangeService } from './exchange.service';
import { Ticker } from './ticker/ticker.entity';
import { TickerService } from './ticker/ticker.service';
import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';

@Module({
  controllers: [ExchangeController],
  exports: [ExchangeService, TickerService],
  imports: [ConfigModule, TypeOrmModule.forFeature([Coin, Exchange, Ticker])],
  providers: [BinanceService, CoinService, ExchangeService, TickerService]
})
export class ExchangeModule {}
