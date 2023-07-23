import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ExchangeController } from './exchange.controller';
import { Exchange } from './exchange.entity';
import { ExchangeService } from './exchange.service';
import { Ticker } from './ticker/ticker.entity';
import { TickerService } from './ticker/ticker.service';

@Module({
  imports: [TypeOrmModule.forFeature([Exchange, Ticker])],
  exports: [ExchangeService, TickerService],
  controllers: [ExchangeController],
  providers: [ExchangeService, TickerService]
})
export class ExchangeModule {}
