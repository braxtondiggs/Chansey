import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';

import { BacktestStatus, BacktestType } from '../../../order/backtest/backtest.entity';

/**
 * Query filters for backtest monitoring endpoints
 */
export class BacktestFiltersDto {
  @ApiPropertyOptional({ description: 'Start date for filtering (ISO string)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date for filtering (ISO string)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Filter by algorithm ID' })
  @IsOptional()
  @IsUUID()
  algorithmId?: string;

  @ApiPropertyOptional({ description: 'Filter by backtest status', enum: BacktestStatus })
  @IsOptional()
  @IsEnum(BacktestStatus)
  status?: BacktestStatus;

  @ApiPropertyOptional({ description: 'Filter by backtest type', enum: BacktestType })
  @IsOptional()
  @IsEnum(BacktestType)
  type?: BacktestType;
}

/**
 * Average performance metrics across backtests
 */
export class AverageMetricsDto {
  @ApiProperty({ description: 'Average Sharpe ratio', example: 1.34 })
  sharpeRatio: number;

  @ApiProperty({ description: 'Average total return percentage', example: 15.5 })
  totalReturn: number;

  @ApiProperty({ description: 'Average maximum drawdown percentage', example: 12.3 })
  maxDrawdown: number;

  @ApiProperty({ description: 'Average win rate (0-1 scale)', example: 0.65 })
  winRate: number;
}

/**
 * Recent activity summary
 */
export class RecentActivityDto {
  @ApiProperty({ description: 'Backtests in last 24 hours' })
  last24h: number;

  @ApiProperty({ description: 'Backtests in last 7 days' })
  last7d: number;

  @ApiProperty({ description: 'Backtests in last 30 days' })
  last30d: number;
}

/**
 * Top performing algorithm summary
 */
export class TopAlgorithmDto {
  @ApiProperty({ description: 'Algorithm ID' })
  id: string;

  @ApiProperty({ description: 'Algorithm name' })
  name: string;

  @ApiProperty({ description: 'Average Sharpe ratio for this algorithm' })
  avgSharpe: number;

  @ApiProperty({ description: 'Total number of backtests for this algorithm' })
  backtestCount: number;

  @ApiProperty({ description: 'Average total return percentage' })
  avgReturn: number;
}

/**
 * Complete overview response for backtest monitoring dashboard
 */
export class BacktestOverviewDto {
  @ApiProperty({
    description: 'Count of backtests by status',
    example: { PENDING: 5, RUNNING: 12, COMPLETED: 847, FAILED: 23, PAUSED: 2, CANCELLED: 8 }
  })
  statusCounts: Record<BacktestStatus, number>;

  @ApiProperty({
    description: 'Distribution of backtests by type',
    example: { HISTORICAL: 500, LIVE_REPLAY: 200, PAPER_TRADING: 150, STRATEGY_OPTIMIZATION: 47 }
  })
  typeDistribution: Record<BacktestType, number>;

  @ApiProperty({ description: 'Average performance metrics across all backtests' })
  averageMetrics: AverageMetricsDto;

  @ApiProperty({ description: 'Recent activity counts' })
  recentActivity: RecentActivityDto;

  @ApiProperty({ description: 'Top performing algorithms by Sharpe ratio', type: [TopAlgorithmDto] })
  topAlgorithms: TopAlgorithmDto[];

  @ApiProperty({ description: 'Total number of backtests matching filters' })
  totalBacktests: number;
}
