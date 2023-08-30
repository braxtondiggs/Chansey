import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ExchangeController } from './exchange.controller';
import { Exchange } from './exchange.entity';
import { ExchangeService } from './exchange.service';
import { Ticker } from './ticker/ticker.entity';
import { TickerService } from './ticker/ticker.service';
import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';

@Module({
  imports: [TypeOrmModule.forFeature([Coin, Exchange, Ticker])],
  exports: [ExchangeService, TickerService],
  controllers: [ExchangeController],
  providers: [CoinService, ExchangeService, TickerService]
})
export class ExchangeModule {}
