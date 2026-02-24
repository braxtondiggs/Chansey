import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { BacktestFiltersDto } from './overview.dto';

import { ReplaySpeed } from '../../../order/backtest/backtest-pacing.interface';
import { BacktestStatus, BacktestType } from '../../../order/backtest/backtest.entity';

/**
 * Sort order enum
 */
export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC'
}

/**
 * Sortable fields for backtests
 */
export enum BacktestSortField {
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
  SHARPE_RATIO = 'sharpeRatio',
  TOTAL_RETURN = 'totalReturn',
  MAX_DRAWDOWN = 'maxDrawdown',
  WIN_RATE = 'winRate',
  TOTAL_TRADES = 'totalTrades',
  NAME = 'name',
  STATUS = 'status'
}

/**
 * Query parameters for paginated backtest list
 */
export class BacktestListQueryDto extends BacktestFiltersDto {
  @ApiPropertyOptional({ description: 'Page number (1-indexed)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Number of items per page', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Field to sort by', enum: BacktestSortField })
  @IsOptional()
  @IsEnum(BacktestSortField)
  sortBy?: BacktestSortField = BacktestSortField.CREATED_AT;

  @ApiPropertyOptional({ description: 'Sort order', enum: SortOrder })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder = SortOrder.DESC;

  @ApiPropertyOptional({ description: 'Search by name (partial match)', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

/**
 * Individual backtest item in the list
 */
export class BacktestListItemDto {
  @ApiProperty({ description: 'Backtest ID' })
  id: string;

  @ApiProperty({ description: 'Backtest name' })
  name: string;

  @ApiPropertyOptional({ description: 'Backtest description' })
  description?: string;

  @ApiProperty({ description: 'Backtest status', enum: BacktestStatus })
  status: BacktestStatus;

  @ApiProperty({ description: 'Backtest type', enum: BacktestType })
  type: BacktestType;

  @ApiProperty({ description: 'Algorithm ID' })
  algorithmId: string;

  @ApiProperty({ description: 'Algorithm name' })
  algorithmName: string;

  @ApiProperty({ description: 'User ID who created the backtest' })
  userId: string;

  @ApiPropertyOptional({ description: 'User email who created the backtest' })
  userEmail?: string;

  @ApiProperty({ description: 'Initial capital for the backtest' })
  initialCapital: number;

  @ApiPropertyOptional({ description: 'Final portfolio value' })
  finalValue?: number;

  @ApiPropertyOptional({ description: 'Total return percentage' })
  totalReturn?: number;

  @ApiPropertyOptional({ description: 'Sharpe ratio' })
  sharpeRatio?: number;

  @ApiPropertyOptional({ description: 'Maximum drawdown percentage' })
  maxDrawdown?: number;

  @ApiPropertyOptional({ description: 'Total number of trades' })
  totalTrades?: number;

  @ApiPropertyOptional({ description: 'Win rate (0-1 scale)' })
  winRate?: number;

  @ApiProperty({ description: 'Backtest start date' })
  startDate: string;

  @ApiProperty({ description: 'Backtest end date' })
  endDate: string;

  @ApiProperty({ description: 'When the backtest was created' })
  createdAt: string;

  @ApiPropertyOptional({ description: 'When the backtest was completed' })
  completedAt?: string;

  @ApiPropertyOptional({ description: 'Error message if failed' })
  errorMessage?: string;

  @ApiProperty({ description: 'Progress percentage (0-100)' })
  progressPercent: number;
}

/**
 * Paginated response wrapper
 */
export class PaginatedBacktestListDto {
  @ApiProperty({ description: 'List of backtests', type: [BacktestListItemDto] })
  data: BacktestListItemDto[];

  @ApiProperty({ description: 'Total number of items matching the filter' })
  total: number;

  @ApiProperty({ description: 'Current page number' })
  page: number;

  @ApiProperty({ description: 'Number of items per page' })
  limit: number;

  @ApiProperty({ description: 'Total number of pages' })
  totalPages: number;

  @ApiProperty({ description: 'Whether there is a next page' })
  hasNextPage: boolean;

  @ApiProperty({ description: 'Whether there is a previous page' })
  hasPreviousPage: boolean;
}

/**
 * Export format options
 */
export enum ExportFormat {
  CSV = 'csv',
  JSON = 'json'
}

// ===========================================================================
// Live Replay Run Listing DTOs
// ===========================================================================

/**
 * Query parameters for paginated live replay run list
 */
export class LiveReplayRunListQueryDto extends BacktestFiltersDto {
  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', default: 10, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class LiveReplayRunListItemDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() algorithmName: string;
  @ApiProperty({ enum: BacktestStatus }) status: BacktestStatus;
  @ApiProperty({ description: 'Progress 0-100' }) progressPercent: number;
  @ApiProperty() processedTimestamps: number;
  @ApiProperty() totalTimestamps: number;
  @ApiProperty({ nullable: true }) totalReturn: number | null;
  @ApiProperty({ nullable: true }) sharpeRatio: number | null;
  @ApiProperty({ nullable: true }) maxDrawdown: number | null;
  @ApiProperty({ nullable: true, description: 'Replay speed multiplier' }) replaySpeed: ReplaySpeed | null;
  @ApiProperty({ nullable: true, description: 'Whether the run is currently paused' }) isPaused: boolean | null;
  @ApiProperty() createdAt: string;
}

export class PaginatedLiveReplayRunsDto {
  @ApiProperty({ type: [LiveReplayRunListItemDto] }) data: LiveReplayRunListItemDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty({ description: 'Total number of pages' }) totalPages: number;
  @ApiProperty({ description: 'Whether there is a next page' }) hasNextPage: boolean;
  @ApiProperty({ description: 'Whether there is a previous page' }) hasPreviousPage: boolean;
}
