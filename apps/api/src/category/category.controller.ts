import { Controller, Get, Param } from '@nestjs/common';

import { Category } from './category.entity';
import { CategoryService } from './category.service';
import FindOneParams from '../utils/findOneParams';

@Controller('category')
export class CategoryController {
  constructor(private readonly category: CategoryService) {}

  @Get()
  async getCategories() {
    return this.category.getCategories();
  }

  @Get(':id')
  getCategoryById(@Param() { id }: FindOneParams): Promise<Category> {
    return this.category.getCategoryById(id);
  }
}
