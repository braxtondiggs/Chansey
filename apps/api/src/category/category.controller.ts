import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { CategoryService } from './category.service';
import { CategoryResponseDto } from './dto/category-response.dto';

@ApiTags('Category')
@Controller('category')
export class CategoryController {
  constructor(private readonly category: CategoryService) {}

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
}
