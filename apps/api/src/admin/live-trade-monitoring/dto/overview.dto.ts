import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Summary metrics for the overview dashboard
 */
export class LiveTradeSummaryDto {
  @ApiProperty({ description: 'Total number of active algorithm activations', example: 42 })
  activeAlgorithms: number;

  @ApiProperty({ description: 'Total number of algorithmic orders', example: 1250 })
  totalOrders: number;

  @ApiProperty({ description: 'Algorithmic orders in the last 24 hours', example: 85 })
  orders24h: number;

  @ApiProperty({ description: 'Algorithmic orders in the last 7 days', example: 450 })
  orders7d: number;

  @ApiProperty({ description: 'Total trading volume in USD', example: 1250000.5 })
  totalVolume: number;

  @ApiProperty({ description: 'Total realized P&L in USD', example: 15250.75 })
  totalPnL: number;

  @ApiProperty({ description: 'Average slippage in basis points', example: 12.5 })
  avgSlippageBps: number;

  @ApiProperty({ description: 'Total number of unique users with active algorithms', example: 15 })
  activeUsers: number;
}

/**
 * Top performing algorithm summary
 */
export class TopPerformingAlgorithmDto {
  @ApiProperty({ description: 'Algorithm ID' })
  algorithmId: string;

  @ApiProperty({ description: 'Algorithm name' })
  algorithmName: string;

  @ApiProperty({ description: 'Number of active user activations' })
  activeActivations: number;

  @ApiProperty({ description: 'Total orders generated' })
  totalOrders: number;

  @ApiProperty({ description: 'Average ROI across all activations', example: 5.25 })
  avgRoi: number;

  @ApiProperty({ description: 'Average win rate', example: 0.65 })
  avgWinRate: number;

  @ApiProperty({ description: 'Average slippage in basis points', example: 10.5 })
  avgSlippageBps: number;
}

/**
 * Recent order summary
 */
export class RecentOrderDto {
  @ApiProperty({ description: 'Order ID' })
  id: string;

  @ApiProperty({ description: 'Trading pair symbol', example: 'BTC/USDT' })
  symbol: string;

  @ApiProperty({ description: 'Order side', example: 'BUY' })
  side: string;

  @ApiProperty({ description: 'Order type', example: 'market' })
  type: string;

  @ApiProperty({ description: 'Order cost in quote currency', example: 1500.5 })
  cost: number;

  @ApiPropertyOptional({ description: 'Actual slippage in basis points', example: 5.2 })
  actualSlippageBps?: number;

  @ApiProperty({ description: 'Algorithm name' })
  algorithmName: string;

  @ApiProperty({ description: 'User email' })
  userEmail: string;

  @ApiProperty({ description: 'Order creation timestamp' })
  createdAt: string;
}

/**
 * Alert summary for the overview
 */
export class AlertsSummaryDto {
  @ApiProperty({ description: 'Number of critical alerts', example: 2 })
  critical: number;

  @ApiProperty({ description: 'Number of warning alerts', example: 5 })
  warning: number;

  @ApiProperty({ description: 'Number of info alerts', example: 10 })
  info: number;
}

/**
 * Complete overview response for live trade monitoring dashboard
 */
export class LiveTradeOverviewDto {
  @ApiProperty({ description: 'Summary metrics' })
  summary: LiveTradeSummaryDto;

  @ApiProperty({ description: 'Top performing algorithms', type: [TopPerformingAlgorithmDto] })
  topAlgorithms: TopPerformingAlgorithmDto[];

  @ApiProperty({ description: 'Recent algorithmic orders', type: [RecentOrderDto] })
  recentOrders: RecentOrderDto[];

  @ApiProperty({ description: 'Alerts summary' })
  alertsSummary: AlertsSummaryDto;
}
