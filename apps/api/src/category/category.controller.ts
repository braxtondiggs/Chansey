import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { Category } from './category.entity';
import { CategoryService } from './category.service';
import FindOneParams from '../utils/findOneParams';

@ApiTags('Category')
@Controller('category')
export class CategoryController {
  constructor(private readonly category: CategoryService) {}

  @Get()
  @ApiOperation({ summary: 'Get all categories', description: 'This endpoint is used to get all categories.' })
  @ApiOkResponse({ description: 'The categories records', type: Category, isArray: true })
  async getCategories() {
    return this.category.getCategories();
  }

  @Get(':id')
  @ApiParam({ name: 'id', required: true, description: 'The id of the category', type: String })
  @ApiOperation({ summary: 'Get category by id', description: 'This endpoint is used to get a category by id.' })
  @ApiOkResponse({ description: 'The category record', type: Category, isArray: false })
  getCategoryById(@Param() { id }: FindOneParams): Promise<Category> {
    return this.category.getCategoryById(id);
  }
}
