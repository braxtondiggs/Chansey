import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TaskService } from './task.service';
import { AppModule } from '../app.module';
import { Category } from '../category/category.entity';
import { CategoryService } from '../category/category.service';
import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';
import { BinanceService } from '../exchange/binance/binance.service';
import { Exchange } from '../exchange/exchange.entity';
import { ExchangeService } from '../exchange/exchange.service';
import { Ticker } from '../exchange/ticker/ticker.entity';
import { TickerService } from '../exchange/ticker/ticker.service';
import { CoinAlertService } from '../portfolio/coin-alert.service';
import { Portfolio } from '../portfolio/portfolio.entity';
import { PortfolioService } from '../portfolio/portfolio.service';
import { Price } from '../price/price.entity';
import { PriceService } from '../price/price.service';

@Module({
  imports: [
    forwardRef(() => AppModule),
    TypeOrmModule.forFeature([Category, Coin, Exchange, Price, Portfolio, Ticker]),
    ScheduleModule.forRoot()
  ],
  providers: [
    BinanceService,
    CategoryService,
    CoinService,
    CoinAlertService,
    ExchangeService,
    PortfolioService,
    PriceService,
    TaskService,
    TickerService
  ]
})
export class TaskModule {}
