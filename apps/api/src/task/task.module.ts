import { MikroOrmModule } from '@mikro-orm/nestjs';
import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';

import { TaskService } from './task.service';
import { Category } from '../category/category.entity';
import { CategoryService } from '../category/category.service';
import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';
import { Portfolio } from '../portfolio/portfolio.entity';
import { PortfolioService } from '../portfolio/portfolio.service';
import { Price } from '../price/price.entity';
import { PriceService } from '../price/price.service';

@Module({
  imports: [HttpModule, MikroOrmModule.forFeature({ entities: [Category, Coin, Price, Portfolio] })],
  providers: [TaskService, CoinService, CategoryService, PriceService, PortfolioService]
})
export class TaskModule {}
