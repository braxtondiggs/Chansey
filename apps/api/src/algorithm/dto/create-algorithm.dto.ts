import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsBoolean, IsOptional, IsString, Validate, IsEnum, IsObject, IsNumber } from 'class-validator';

import { AlgorithmStatus, AlgorithmCategory, AlgorithmConfig } from '../algorithm.entity';

export class CreateAlgorithmDto {
  @IsString()
  @ApiProperty({
    example: 'Exponential Moving Average',
    required: true,
    description: 'Name of this algorithm, must be unique'
  })
  name: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    example: 'exponential-moving-average',
    description: 'Strategy ID that implements this algorithm'
  })
  strategyId?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    example: 'ExponentialMovingAverageService',
    description: 'Legacy service name (deprecated, use strategyId instead)',
    deprecated: true
  })
  service?: string;

  @IsOptional()
  @IsEnum(AlgorithmCategory)
  @ApiPropertyOptional({
    enum: AlgorithmCategory,
    example: AlgorithmCategory.TECHNICAL,
    description: 'Category of the algorithm'
  })
  category?: AlgorithmCategory;

  @IsOptional()
  @IsEnum(AlgorithmStatus)
  @ApiPropertyOptional({
    enum: AlgorithmStatus,
    example: AlgorithmStatus.INACTIVE,
    description: 'Initial status of the algorithm'
  })
  status?: AlgorithmStatus;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({ 
    example: true, 
    default: true, 
    description: 'Whether to include this algorithm in evaluations' 
  })
  evaluate?: boolean;

  @IsOptional()
  @IsString()
  @Validate(
    (text: string) =>
      new RegExp(
        /^(\*|((\*\/)?[1-5]?[0-9])) (\*|((\*\/)?[1-5]?[0-9])) (\*|((\*\/)?(1?[0-9]|2[0-3]))) (\*|((\*\/)?([1-9]|[12][0-9]|3[0-1]))) (\*|((\*\/)?([1-9]|1[0-2]))) (\*|((\*\/)?[0-6]))$/
      ).test(text),
    {
      message: 'Cron expression is not valid'
    }
  )
  @ApiPropertyOptional({
    example: '0 */4 * * *',
    default: '0 */4 * * *',
    description: 'Cron expression for automatic algorithm execution'
  })
  cron?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    example: 'Technical analysis algorithm using exponential moving averages to generate trading signals.',
    description: 'Description of this algorithm'
  })
  description?: string;

  @IsOptional()
  @IsNumber()
  @ApiPropertyOptional({
    example: 1.0,
    description: 'Weight of the algorithm in portfolio calculations'
  })
  weight?: number;

  @IsOptional()
  @IsObject()
  @ApiPropertyOptional({
    example: {
      parameters: {
        period: 20,
        multiplier: 2.0
      },
      settings: {
        timeout: 30000,
        retries: 3,
        enableLogging: true
      }
    },
    description: 'Algorithm configuration and parameters'
  })
  config?: AlgorithmConfig;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    example: '1.0.0',
    description: 'Version of the algorithm implementation'
  })
  version?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    example: 'Trading Team',
    description: 'Author or creator of the algorithm'
  })
  author?: string;
}
