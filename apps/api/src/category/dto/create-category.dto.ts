import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ example: 'wrapped-tokens', description: 'Identifier Slug' })
  slug: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ example: 'WrappedTokens', description: 'Category name' })
  name: string;
}
