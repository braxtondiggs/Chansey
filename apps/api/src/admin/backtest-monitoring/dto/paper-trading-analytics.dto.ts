import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';

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

export class PipelineStageCountsDto {
  @ApiProperty({ description: 'Total optimization runs' })
  optimizationRuns: number;

  @ApiProperty({ description: 'Total historical backtests' })
  historicalBacktests: number;

  @ApiProperty({ description: 'Total live replay backtests' })
  liveReplayBacktests: number;

  @ApiProperty({ description: 'Total paper trading sessions' })
  paperTradingSessions: number;
}
