import { ApiProperty } from '@nestjs/swagger';

import { CreateCategoryDto } from './create-category.dto';

export class CategoryResponseDto {
  @ApiProperty({
    description: 'Unique identifier for the category',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  id: string;

  @ApiProperty({
    description: 'Unique slug identifier for the category',
    example: 'technology'
  })
  slug: string;

  @ApiProperty({
    description: 'Name of the category',
    example: 'Technology'
  })
  name: string;

  @ApiProperty({
    description: 'Timestamp when the category was created',
    example: '2024-04-23T18:25:43.511Z',
    type: 'string',
    format: 'date-time'
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Timestamp when the category was last updated',
    example: '2024-04-23T18:25:43.511Z',
    type: 'string',
    format: 'date-time'
  })
  updatedAt: Date;

  constructor(category: Partial<CreateCategoryDto>) {
    Object.assign(this, category);
  }
}
