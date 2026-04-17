import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

import { PaperTradingStatus } from '../../../order/paper-trading/entities/paper-trading-session.entity';

/**
 * Query filters for paper trading analytics endpoints
 */
export class PaperTradingFiltersDto {
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

  @ApiPropertyOptional({ description: 'Filter by session status', enum: PaperTradingStatus })
  @IsOptional()
  @IsEnum(PaperTradingStatus)
  status?: PaperTradingStatus;
}

export class PaperTradingTopAlgorithmDto {
  @ApiProperty({ description: 'Algorithm ID' })
  algorithmId: string;

  @ApiProperty({ description: 'Algorithm name' })
  algorithmName: string;

  @ApiProperty({ description: 'Number of paper trading sessions' })
  sessionCount: number;

  @ApiProperty({ description: 'Average return across sessions', example: 5.2 })
  avgReturn: number;

  @ApiProperty({ description: 'Average Sharpe ratio', example: 1.34 })
  avgSharpe: number;
}

export class PaperTradingSymbolBreakdownDto {
  @ApiProperty({ description: 'Trading pair symbol', example: 'BTC/USD' })
  symbol: string;

  @ApiProperty({ description: 'Number of orders for this symbol' })
  orderCount: number;

  @ApiProperty({ description: 'Total volume traded', example: 50000 })
  totalVolume: number;

  @ApiProperty({ description: 'Total realized P&L', example: 1200 })
  totalPnL: number;
}

export class PaperTradingOrderAnalyticsDto {
  @ApiProperty({ description: 'Total number of orders' })
  totalOrders: number;

  @ApiProperty({ description: 'Number of buy orders' })
  buyCount: number;

  @ApiProperty({ description: 'Number of sell orders' })
  sellCount: number;

  @ApiProperty({ description: 'Total volume traded' })
  totalVolume: number;

  @ApiProperty({ description: 'Total fees paid' })
  totalFees: number;

  @ApiProperty({ description: 'Average slippage in basis points' })
  avgSlippageBps: number;

  @ApiProperty({ description: 'Total realized P&L' })
  totalPnL: number;

  @ApiProperty({ description: 'Per-symbol breakdown', type: [PaperTradingSymbolBreakdownDto] })
  bySymbol: PaperTradingSymbolBreakdownDto[];
}

export class PaperTradingSignalAnalyticsDto {
  @ApiProperty({ description: 'Total number of signals' })
  totalSignals: number;

  @ApiProperty({ description: 'Percentage of signals processed (0-1)', example: 0.92 })
  processedRate: number;

  @ApiProperty({ description: 'Average confidence score (0-1)', example: 0.78 })
  avgConfidence: number;

  @ApiProperty({ description: 'Signal counts by type' })
  byType: Record<string, number>;

  @ApiProperty({ description: 'Signal counts by direction' })
  byDirection: Record<string, number>;
}

export class PaperTradingMonitoringDto {
  @ApiProperty({
    description: 'Count of sessions by status',
    example: { ACTIVE: 3, PAUSED: 1, COMPLETED: 10, FAILED: 2, STOPPED: 4 }
  })
  statusCounts: Record<PaperTradingStatus, number>;

  @ApiProperty({ description: 'Total number of paper trading sessions' })
  totalSessions: number;

  @ApiProperty({ description: 'Recent activity counts' })
  recentActivity: { last24h: number; last7d: number; last30d: number };

  @ApiProperty({ description: 'Average performance metrics across sessions' })
  avgMetrics: { sharpeRatio: number; totalReturn: number; maxDrawdown: number; winRate: number };

  @ApiProperty({ description: 'Top algorithms by session performance', type: [PaperTradingTopAlgorithmDto] })
  topAlgorithms: PaperTradingTopAlgorithmDto[];

  @ApiProperty({ description: 'Order analytics summary' })
  orderAnalytics: PaperTradingOrderAnalyticsDto;

  @ApiProperty({ description: 'Signal analytics summary' })
  signalAnalytics: PaperTradingSignalAnalyticsDto;
}

export class StageCountWithStatusDto {
  @ApiProperty({ description: 'Total count for this stage' })
  total: number;

  @ApiProperty({ description: 'Count breakdown by status', example: { COMPLETED: 50, RUNNING: 3, FAILED: 2 } })
  statusBreakdown: Record<string, number>;
}

export class PipelineStageCountsDto {
  @ApiProperty({ description: 'Optimization runs with status breakdown', type: StageCountWithStatusDto })
  optimizationRuns: StageCountWithStatusDto;

  @ApiProperty({ description: 'Historical backtests with status breakdown', type: StageCountWithStatusDto })
  historicalBacktests: StageCountWithStatusDto;

  @ApiProperty({ description: 'Live replay backtests with status breakdown', type: StageCountWithStatusDto })
  liveReplayBacktests: StageCountWithStatusDto;

  @ApiProperty({ description: 'Paper trading sessions with status breakdown', type: StageCountWithStatusDto })
  paperTradingSessions: StageCountWithStatusDto;
}

/**
 * Query DTO for paginated paper trading session listing
 */
export class PaperTradingSessionListQueryDto extends PaperTradingFiltersDto {
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

export class PaperTradingSessionListItemDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() algorithmName: string;
  @ApiProperty({ enum: PaperTradingStatus }) status: PaperTradingStatus;
  @ApiProperty({ description: 'Progress 0-100' }) progressPercent: number;
  @ApiProperty({ nullable: true }) totalReturn: number | null;
  @ApiProperty({ nullable: true }) sharpeRatio: number | null;
  @ApiProperty() duration: string;
  @ApiProperty({ nullable: true }) startedAt: string | null;
  @ApiProperty() createdAt: string;
  @ApiProperty({ nullable: true, required: false }) stoppedReason?: string | null;
}

export class PaginatedPaperTradingSessionsDto {
  @ApiProperty({ type: [PaperTradingSessionListItemDto] }) data: PaperTradingSessionListItemDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty({ description: 'Total number of pages' }) totalPages: number;
  @ApiProperty({ description: 'Whether there is a next page' }) hasNextPage: boolean;
  @ApiProperty({ description: 'Whether there is a previous page' }) hasPreviousPage: boolean;
}
