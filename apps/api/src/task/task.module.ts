import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TaskService } from './task.service';
import { Category } from '../category/category.entity';
import { CategoryService } from '../category/category.service';
import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';
import { Exchange } from '../exchange/exchange.entity';
import { ExchangeService } from '../exchange/exchange.service';
import { Ticker } from '../exchange/ticker/ticker.entity';
import { TickerService } from '../exchange/ticker/ticker.service';
import { Portfolio } from '../portfolio/portfolio.entity';
import { PortfolioService } from '../portfolio/portfolio.service';
import { Price } from '../price/price.entity';
import { PriceService } from '../price/price.service';
import User from '../users/users.entity';
import UsersService from '../users/users.service';

@Module({
  imports: [
    ConfigModule,
    HttpModule,
    TypeOrmModule.forFeature([Category, Coin, Exchange, Price, Portfolio, Ticker, User]),
    ScheduleModule.forRoot()
  ],
  providers: [
    CategoryService,
    CoinService,
    ExchangeService,
    PortfolioService,
    PriceService,
    TaskService,
    TickerService,
    UsersService
  ]
})
export class TaskModule {}
