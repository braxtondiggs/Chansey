import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppModule } from '../app.module';
import { CategoryController } from './category.controller';
import { Category } from './category.entity';
import { CategoryService } from './category.service';
import { CategoryTask } from './category.task';

@Module({
  imports: [forwardRef(() => AppModule), TypeOrmModule.forFeature([Category])],
  providers: [CategoryService, CategoryTask],
  controllers: [CategoryController],
  exports: [CategoryService]
})
export class CategoryModule {}
