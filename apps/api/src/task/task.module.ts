import { MikroOrmModule } from '@mikro-orm/nestjs';
import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';

import { TaskService } from './task.service';
import { Category } from '../category/category.entity';
import { CategoryService } from '../category/category.service';
import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';

@Module({
  imports: [HttpModule, MikroOrmModule.forFeature({ entities: [Category, Coin] })],
  providers: [TaskService, CoinService, CategoryService]
})
export class TaskModule {}
