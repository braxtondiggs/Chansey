import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { CategoryService } from './category.service';
import { CategoryTask } from './category.task';
import { CategoryResponseDto } from './dto/category-response.dto';

@ApiTags('Category')
@Controller('category')
export class CategoryController {
  constructor(
    private readonly category: CategoryService,
    private readonly categoryTask: CategoryTask
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get All Categories',
    description: 'Retrieve a list of all available categories.'
  })
  @ApiOkResponse({
    description: 'List of categories retrieved successfully.',
    type: CategoryResponseDto,
    isArray: true
  })
  async getCategories() {
    return this.category.getCategories();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get Category by ID',
    description: 'Retrieve a specific category using its unique UUID.'
  })
  @ApiParam({
    name: 'id',
    required: true,
    description: 'The UUID of the category to retrieve.',
    type: String,
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  @ApiOkResponse({
    description: 'Category retrieved successfully.',
    type: CategoryResponseDto,
    isArray: false
  })
  @ApiNotFoundResponse({
    description: 'Category not found with the provided ID.'
  })
  getCategoryById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.category.getCategoryById(id);
  }

  @Post('sync')
  @ApiOperation({
    summary: 'Sync Categories',
    description: 'Manually trigger the synchronization of categories from the external API.'
  })
  @ApiOkResponse({
    description: 'Categories synced successfully.',
    schema: {
      properties: {
        message: { type: 'string', example: 'Categories synced successfully' }
      }
    }
  })
  async syncCategories() {
    await this.categoryTask.syncCategories();
    return { message: 'Categories synced successfully' };
  }
}
