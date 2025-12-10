import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, Max, Min } from 'class-validator';

import { OptimizationStatus } from '../entities/optimization-run.entity';

/**
 * Window result DTO
 */
export class WindowResultDto {
  @ApiProperty({ description: 'Window index' })
  windowIndex: number;

  @ApiProperty({ description: 'Training period score' })
  trainScore: number;

  @ApiProperty({ description: 'Testing period score' })
  testScore: number;

  @ApiProperty({ description: 'Degradation percentage' })
  degradation: number;

  @ApiProperty({ description: 'Whether overfitting was detected' })
  overfitting: boolean;

  @ApiProperty({ description: 'Training period start date' })
  trainStartDate: string;

  @ApiProperty({ description: 'Training period end date' })
  trainEndDate: string;

  @ApiProperty({ description: 'Testing period start date' })
  testStartDate: string;

  @ApiProperty({ description: 'Testing period end date' })
  testEndDate: string;
}

/**
 * Optimization result DTO
 */
export class OptimizationResultDto {
  @ApiProperty({ description: 'Result ID' })
  id: string;

  @ApiProperty({ description: 'Rank (1 = best)' })
  rank: number;

  @ApiProperty({ description: 'Parameter combination' })
  parameters: Record<string, unknown>;

  @ApiProperty({ description: 'Average training score' })
  avgTrainScore: number;

  @ApiProperty({ description: 'Average testing score' })
  avgTestScore: number;

  @ApiProperty({ description: 'Average degradation percentage' })
  avgDegradation: number;

  @ApiProperty({ description: 'Consistency score (0-100)' })
  consistencyScore: number;

  @ApiProperty({ description: 'Number of windows with overfitting detected' })
  overfittingWindows: number;

  @ApiProperty({ description: 'Whether this is the baseline combination' })
  isBaseline: boolean;

  @ApiProperty({ description: 'Whether this is the best combination' })
  isBest: boolean;

  @ApiProperty({ description: 'Window-level results', type: [WindowResultDto] })
  windowResults: WindowResultDto[];
}

/**
 * Optimization progress DTO
 */
export class OptimizationProgressDto {
  @ApiProperty({ description: 'Current status', enum: OptimizationStatus })
  status: OptimizationStatus;

  @ApiProperty({ description: 'Number of combinations tested' })
  combinationsTested: number;

  @ApiProperty({ description: 'Total number of combinations' })
  totalCombinations: number;

  @ApiProperty({ description: 'Percentage complete' })
  percentComplete: number;

  @ApiProperty({ description: 'Estimated time remaining in seconds' })
  estimatedTimeRemaining: number;

  @ApiPropertyOptional({ description: 'Current best score' })
  currentBestScore: number | null;
}

/**
 * Optimization run summary DTO
 */
export class OptimizationRunSummaryDto {
  @ApiProperty({ description: 'Run ID' })
  id: string;

  @ApiProperty({ description: 'Strategy config ID' })
  strategyConfigId: string;

  @ApiProperty({ description: 'Status', enum: OptimizationStatus })
  status: OptimizationStatus;

  @ApiProperty({ description: 'Search method' })
  method: string;

  @ApiProperty({ description: 'Total combinations' })
  totalCombinations: number;

  @ApiProperty({ description: 'Combinations tested' })
  combinationsTested: number;

  @ApiPropertyOptional({ description: 'Best score achieved' })
  bestScore: number | null;

  @ApiPropertyOptional({ description: 'Improvement over baseline (percentage)' })
  improvement: number | null;

  @ApiProperty({ description: 'Created timestamp' })
  createdAt: Date;

  @ApiPropertyOptional({ description: 'Completed timestamp' })
  completedAt: Date | null;
}

/**
 * Query parameters for getting optimization results
 */
export class OptimizationResultsQueryDto {
  @ApiPropertyOptional({ description: 'Number of results to return', default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Sort by field',
    enum: ['testScore', 'degradation', 'consistency'],
    default: 'testScore'
  })
  @IsOptional()
  @IsEnum(['testScore', 'degradation', 'consistency'])
  sortBy?: 'testScore' | 'degradation' | 'consistency' = 'testScore';
}

/**
 * Query parameters for listing optimization runs
 */
export class OptimizationRunsQueryDto {
  @ApiPropertyOptional({ description: 'Filter by status', enum: OptimizationStatus })
  @IsOptional()
  @IsEnum(OptimizationStatus)
  status?: OptimizationStatus;
}

/**
 * Optimization comparison DTO
 */
export class OptimizationComparisonDto {
  @ApiProperty({ description: 'Baseline parameters' })
  baseline: {
    parameters: Record<string, unknown>;
    avgTestScore: number;
  };

  @ApiProperty({ description: 'Best optimized parameters' })
  optimized: {
    parameters: Record<string, unknown>;
    avgTestScore: number;
  };

  @ApiProperty({ description: 'Improvement percentage' })
  improvement: number;

  @ApiProperty({ description: 'Parameters that changed' })
  changedParameters: Array<{
    name: string;
    baselineValue: unknown;
    optimizedValue: unknown;
  }>;
}
