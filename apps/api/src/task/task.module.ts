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
    TypeOrmModule.forFeature([Category, Coin, Price, Portfolio, User]),
    ScheduleModule.forRoot()
  ],
  providers: [TaskService, CoinService, CategoryService, PriceService, PortfolioService, UsersService]
})
export class TaskModule {}
