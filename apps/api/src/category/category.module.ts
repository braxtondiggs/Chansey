import { BullModule } from '@nestjs/bullmq';
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CategoryController } from './category.controller';
import { Category } from './category.entity';
import { CategoryService } from './category.service';
import { CategorySyncTask } from './tasks/category-sync.task';

import { AppModule } from '../app.module';

@Module({
  imports: [
    forwardRef(() => AppModule),
    TypeOrmModule.forFeature([Category]),
    BullModule.registerQueue({ name: 'category-queue' })
  ],
  providers: [CategoryService, CategorySyncTask],
  controllers: [CategoryController],
  exports: [CategoryService]
})
export class CategoryModule {}
