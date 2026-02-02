import { ApiProperty } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

import { PipelineStage, PipelineStatus } from '../interfaces';

/**
 * DTO for filtering pipeline list
 */
export class PipelineFiltersDto {
  @IsEnum(PipelineStatus)
  @IsOptional()
  @ApiProperty({
    description: 'Filter by pipeline status',
    enum: PipelineStatus,
    required: false
  })
  status?: PipelineStatus;

  @IsEnum(PipelineStage)
  @IsOptional()
  @ApiProperty({
    description: 'Filter by current stage',
    enum: PipelineStage,
    required: false
  })
  currentStage?: PipelineStage;

  @IsUUID('4')
  @IsOptional()
  @ApiProperty({
    description: 'Filter by strategy configuration ID',
    required: false
  })
  strategyConfigId?: string;

  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  @ApiProperty({
    description: 'Number of results to return',
    minimum: 1,
    maximum: 100,
    default: 20,
    required: false
  })
  limit?: number = 20;

  @IsInt()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  @ApiProperty({
    description: 'Number of results to skip',
    minimum: 0,
    default: 0,
    required: false
  })
  offset?: number = 0;
}
