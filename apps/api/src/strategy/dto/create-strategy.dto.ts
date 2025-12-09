import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsString, IsUUID, IsObject, IsOptional, IsNotEmpty, MinLength } from 'class-validator';

/**
 * DTO for creating a new strategy configuration
 */
export class CreateStrategyDto {
  @ApiProperty({
    description: 'Human-readable strategy name',
    example: 'EMA Crossover 12/26'
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  name: string;

  @ApiProperty({
    description: 'ID of the algorithm this strategy is based on',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  @IsUUID()
  @IsNotEmpty()
  algorithmId: string;

  @ApiProperty({
    description: 'Strategy-specific parameters that override algorithm defaults',
    example: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }
  })
  @IsObject()
  @IsNotEmpty()
  parameters: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Semantic version for tracking changes',
    example: '1.0.0',
    default: '1.0.0'
  })
  @IsString()
  @IsOptional()
  version?: string;

  @ApiPropertyOptional({
    description: 'Parent strategy ID for version tracking',
    example: '550e8400-e29b-41d4-a716-446655440001'
  })
  @IsUUID()
  @IsOptional()
  parentId?: string;
}
