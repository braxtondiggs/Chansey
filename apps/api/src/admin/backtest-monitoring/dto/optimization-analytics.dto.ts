import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsDateString, IsEnum, IsOptional } from 'class-validator';

import { OptimizationStatus } from '../../../optimization/entities/optimization-run.entity';

/**
 * Query filters for optimization analytics endpoints
 */
export class OptimizationFiltersDto {
  @ApiPropertyOptional({ description: 'Start date for filtering (ISO string)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date for filtering (ISO string)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Filter by optimization status', enum: OptimizationStatus })
  @IsOptional()
  @IsEnum(OptimizationStatus)
  status?: OptimizationStatus;
}

export class OptimizationTopStrategyDto {
  @ApiProperty({ description: 'Algorithm ID' })
  algorithmId: string;

  @ApiProperty({ description: 'Algorithm name' })
  algorithmName: string;

  @ApiProperty({ description: 'Number of optimization runs' })
  runCount: number;

  @ApiProperty({ description: 'Average improvement over baseline', example: 12.5 })
  avgImprovement: number;

  @ApiProperty({ description: 'Average best score achieved', example: 1.85 })
  avgBestScore: number;
}

export class OptimizationResultSummaryDto {
  @ApiProperty({ description: 'Average train score across all results', example: 1.5 })
  avgTrainScore: number;

  @ApiProperty({ description: 'Average test score across all results', example: 1.2 })
  avgTestScore: number;

  @ApiProperty({ description: 'Average degradation (train→test)', example: 0.2 })
  avgDegradation: number;

  @ApiProperty({ description: 'Average consistency score (0-100)', example: 72.5 })
  avgConsistency: number;

  @ApiProperty({ description: 'Rate of overfitting across results (0-1)', example: 0.15 })
  overfittingRate: number;
}

export class OptimizationAnalyticsDto {
  @ApiProperty({
    description: 'Count of optimization runs by status',
    example: { PENDING: 2, RUNNING: 1, COMPLETED: 15, FAILED: 3, CANCELLED: 0 }
  })
  statusCounts: Record<OptimizationStatus, number>;

  @ApiProperty({ description: 'Total number of optimization runs' })
  totalRuns: number;

  @ApiProperty({ description: 'Recent activity counts' })
  recentActivity: { last24h: number; last7d: number; last30d: number };

  @ApiProperty({ description: 'Average improvement over baseline', example: 10.2 })
  avgImprovement: number;

  @ApiProperty({ description: 'Average best score across completed runs', example: 1.65 })
  avgBestScore: number;

  @ApiProperty({ description: 'Average combinations tested per run' })
  avgCombinationsTested: number;

  @ApiProperty({ description: 'Top strategies by optimization results', type: [OptimizationTopStrategyDto] })
  topStrategies: OptimizationTopStrategyDto[];

  @ApiProperty({ description: 'Summary of optimization result quality' })
  resultSummary: OptimizationResultSummaryDto;
}
