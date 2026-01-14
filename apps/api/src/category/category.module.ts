import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CategoryController } from './category.controller';
import { Category } from './category.entity';
import { CategoryService } from './category.service';
import { CategorySyncTask } from './tasks/category-sync.task';

@Module({
  imports: [TypeOrmModule.forFeature([Category]), HttpModule, BullModule.registerQueue({ name: 'category-queue' })],
  providers: [CategoryService, CategorySyncTask],
  controllers: [CategoryController],
  exports: [CategoryService]
})
export class CategoryModule {}
