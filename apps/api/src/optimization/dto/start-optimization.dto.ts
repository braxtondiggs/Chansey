import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested
} from 'class-validator';

/**
 * Parameter definition DTO
 */
export class ParameterDefinitionDto {
  @ApiProperty({ description: 'Parameter name', example: 'lookbackPeriod' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Parameter type', enum: ['integer', 'float', 'categorical'] })
  @IsEnum(['integer', 'float', 'categorical'])
  type: 'integer' | 'float' | 'categorical';

  @ApiPropertyOptional({ description: 'Minimum value (for numeric types)', example: 10 })
  @IsOptional()
  @IsNumber()
  min?: number;

  @ApiPropertyOptional({ description: 'Maximum value (for numeric types)', example: 50 })
  @IsOptional()
  @IsNumber()
  max?: number;

  @ApiPropertyOptional({ description: 'Step size (for numeric types)', example: 5 })
  @IsOptional()
  @IsNumber()
  step?: number;

  @ApiPropertyOptional({ description: 'Possible values (for categorical types)', example: ['rsi', 'macd', 'sma'] })
  @IsOptional()
  @IsArray()
  values?: (string | number | boolean)[];

  @ApiProperty({ description: 'Default value', example: 20 })
  default: number | string | boolean;

  @ApiProperty({ description: 'Parameter priority', enum: ['high', 'medium', 'low'], example: 'high' })
  @IsEnum(['high', 'medium', 'low'])
  priority: 'high' | 'medium' | 'low';

  @ApiPropertyOptional({ description: 'Parameter description' })
  @IsOptional()
  @IsString()
  description?: string;
}

/**
 * Parameter constraint DTO
 */
export class ParameterConstraintDto {
  @ApiProperty({ description: 'Constraint type', enum: ['less_than', 'greater_than', 'not_equal', 'custom'] })
  @IsEnum(['less_than', 'greater_than', 'not_equal', 'custom'])
  type: 'less_than' | 'greater_than' | 'not_equal' | 'custom';

  @ApiProperty({ description: 'First parameter name', example: 'stopLoss' })
  @IsString()
  param1: string;

  @ApiPropertyOptional({ description: 'Second parameter name', example: 'takeProfit' })
  @IsOptional()
  @IsString()
  param2?: string;

  @ApiPropertyOptional({ description: 'Fixed value to compare against' })
  @IsOptional()
  @IsNumber()
  value?: number;

  @ApiPropertyOptional({ description: 'Error message when constraint is violated' })
  @IsOptional()
  @IsString()
  message?: string;
}

/**
 * Parameter space DTO
 */
export class ParameterSpaceDto {
  @ApiProperty({ description: 'Strategy type identifier', example: 'momentum' })
  @IsString()
  strategyType: string;

  @ApiProperty({ description: 'List of optimizable parameters', type: [ParameterDefinitionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ParameterDefinitionDto)
  parameters: ParameterDefinitionDto[];

  @ApiPropertyOptional({ description: 'Constraints between parameters', type: [ParameterConstraintDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ParameterConstraintDto)
  constraints?: ParameterConstraintDto[];

  @ApiPropertyOptional({ description: 'Version identifier' })
  @IsOptional()
  @IsString()
  version?: string;
}

/**
 * Walk-forward config DTO
 */
export class WalkForwardConfigDto {
  @ApiProperty({ description: 'Training period in days', example: 180, minimum: 30 })
  @IsNumber()
  @Min(30)
  trainDays: number;

  @ApiProperty({ description: 'Testing period in days', example: 90, minimum: 14 })
  @IsNumber()
  @Min(14)
  testDays: number;

  @ApiProperty({ description: 'Step size between windows in days', example: 30, minimum: 1 })
  @IsNumber()
  @Min(1)
  stepDays: number;

  @ApiProperty({ description: 'Window generation method', enum: ['rolling', 'anchored'], example: 'rolling' })
  @IsEnum(['rolling', 'anchored'])
  method: 'rolling' | 'anchored';

  @ApiProperty({ description: 'Minimum number of windows required', example: 3, minimum: 1 })
  @IsNumber()
  @Min(1)
  minWindowsRequired: number;

  @ApiPropertyOptional({ description: 'Maximum acceptable degradation percentage', example: 30 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  maxAcceptableDegradation?: number;
}

/**
 * Optimization objective DTO
 */
export class OptimizationObjectiveDto {
  @ApiProperty({
    description: 'Primary metric to optimize',
    enum: ['sharpe_ratio', 'total_return', 'calmar_ratio', 'profit_factor', 'sortino_ratio', 'composite'],
    example: 'sharpe_ratio'
  })
  @IsEnum(['sharpe_ratio', 'total_return', 'calmar_ratio', 'profit_factor', 'sortino_ratio', 'composite'])
  metric: 'sharpe_ratio' | 'total_return' | 'calmar_ratio' | 'profit_factor' | 'sortino_ratio' | 'composite';

  @ApiPropertyOptional({ description: 'Weights for composite metric optimization' })
  @IsOptional()
  @IsObject()
  weights?: {
    sharpeRatio?: number;
    totalReturn?: number;
    calmarRatio?: number;
    profitFactor?: number;
    maxDrawdown?: number;
    winRate?: number;
  };

  @ApiProperty({ description: 'Whether to minimize the objective', example: false })
  @IsBoolean()
  minimize: boolean;
}

/**
 * Early stopping config DTO
 */
export class EarlyStopConfigDto {
  @ApiProperty({ description: 'Whether early stopping is enabled', example: true })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ description: 'Stop if no improvement after this many combinations', example: 50 })
  @IsNumber()
  @Min(1)
  patience: number;

  @ApiProperty({ description: 'Minimum improvement threshold (percentage)', example: 1 })
  @IsNumber()
  @Min(0)
  minImprovement: number;
}

/**
 * Date range DTO
 */
export class DateRangeDto {
  @ApiProperty({ description: 'Start date', example: '2022-01-01' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: 'End date', example: '2024-12-01' })
  @IsDateString()
  endDate: string;
}

/**
 * Optimization config DTO
 */
export class OptimizationConfigDto {
  @ApiProperty({ description: 'Search method', enum: ['grid_search', 'random_search'], example: 'grid_search' })
  @IsEnum(['grid_search', 'random_search'])
  method: 'grid_search' | 'random_search';

  @ApiPropertyOptional({ description: 'Maximum iterations for random search', example: 100 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxIterations?: number;

  @ApiPropertyOptional({ description: 'Maximum combinations to test for grid search', example: 1000 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxCombinations?: number;

  @ApiProperty({ description: 'Walk-forward analysis configuration' })
  @ValidateNested()
  @Type(() => WalkForwardConfigDto)
  walkForward: WalkForwardConfigDto;

  @ApiProperty({ description: 'Optimization objective' })
  @ValidateNested()
  @Type(() => OptimizationObjectiveDto)
  objective: OptimizationObjectiveDto;

  @ApiPropertyOptional({ description: 'Early stopping configuration' })
  @IsOptional()
  @ValidateNested()
  @Type(() => EarlyStopConfigDto)
  earlyStop?: EarlyStopConfigDto;

  @ApiPropertyOptional({ description: 'Date range for backtesting' })
  @IsOptional()
  @ValidateNested()
  @Type(() => DateRangeDto)
  dateRange?: DateRangeDto;
}

/**
 * Start optimization request DTO
 */
export class StartOptimizationDto {
  @ApiProperty({ description: 'Parameter space definition' })
  @ValidateNested()
  @Type(() => ParameterSpaceDto)
  parameterSpace: ParameterSpaceDto;

  @ApiPropertyOptional({ description: 'Optimization configuration' })
  @IsOptional()
  @ValidateNested()
  @Type(() => OptimizationConfigDto)
  config?: OptimizationConfigDto;
}
