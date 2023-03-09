import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { Category } from './category.entity';
import { CategoryService } from './category.service';
import FindOneParams from '../utils/findOneParams';

@ApiTags('Category')
@Controller('category')
export class CategoryController {
  constructor(private readonly category: CategoryService) {}

  @Get()
  @ApiOperation({})
  async getCategories() {
    return this.category.getCategories();
  }

  @Get(':id')
  @ApiParam({
    name: 'id',
    required: true,
    description: 'The id of the category',
    type: String
  })
  getCategoryById(@Param() { id }: FindOneParams): Promise<Category> {
    return this.category.getCategoryById(id);
  }
}
