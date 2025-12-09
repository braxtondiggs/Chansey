import { ApiPropertyOptional } from '@nestjs/swagger';

import { IsString, IsObject, IsOptional, IsEnum, MinLength } from 'class-validator';

import { StrategyStatus } from '@chansey/api-interfaces';

/**
 * DTO for updating a strategy configuration
 */
export class UpdateStrategyDto {
  @ApiPropertyOptional({
    description: 'Human-readable strategy name',
    example: 'EMA Crossover 12/26 v2'
  })
  @IsString()
  @IsOptional()
  @MinLength(3)
  name?: string;

  @ApiPropertyOptional({
    description: 'Strategy-specific parameters',
    example: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, stopLoss: 0.05 }
  })
  @IsObject()
  @IsOptional()
  parameters?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Semantic version',
    example: '1.1.0'
  })
  @IsString()
  @IsOptional()
  version?: string;

  @ApiPropertyOptional({
    description: 'Strategy status',
    enum: StrategyStatus,
    example: StrategyStatus.TESTING
  })
  @IsEnum(StrategyStatus)
  @IsOptional()
  status?: StrategyStatus;
}
