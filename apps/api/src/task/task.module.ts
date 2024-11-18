import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TaskService } from './task.service';
import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';
import { BinanceService } from '../exchange/binance/binance.service';
import { Exchange } from '../exchange/exchange.entity';
import { ExchangeService } from '../exchange/exchange.service';
import { Portfolio } from '../portfolio/portfolio.entity';
import { PortfolioService } from '../portfolio/portfolio.service';
import { Price } from '../price/price.entity';
import { PriceService } from '../price/price.service';

@Module({
  imports: [TypeOrmModule.forFeature([Coin, Exchange, Price, Portfolio]), ScheduleModule.forRoot()],
  providers: [BinanceService, ConfigService, ExchangeService, CoinService, PortfolioService, PriceService, TaskService]
})
export class TaskModule {}
