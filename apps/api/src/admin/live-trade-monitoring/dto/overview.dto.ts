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

  @ApiProperty({ description: 'Total signals emitted across live + paper trading', example: 190502 })
  signalsTotal: number;

  @ApiProperty({ description: 'Signals that resulted in placed/simulated trades', example: 568 })
  signalsPlaced: number;

  @ApiProperty({ description: 'Signal → trade conversion percentage', example: 0.3 })
  signalConversionPct: number;
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

  @ApiPropertyOptional({ description: 'Signal → trade conversion percentage for this algorithm', example: 0.3 })
  signalConversionPct?: number;
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
 * Single rejection-reason breakdown row
 */
export class SignalRejectionReasonDto {
  @ApiProperty({ description: 'Machine-readable rejection reason code', example: 'SIGNAL_THROTTLED' })
  reasonCode: string;

  @ApiProperty({ description: 'Number of signals rejected for this reason', example: 180133 })
  count: number;

  @ApiProperty({ description: 'Share of total signals rejected for this reason', example: 94.6 })
  pct: number;
}

/**
 * Signal → trade conversion panel for the overview dashboard.
 * Aggregates live + paper trading signals so operators can spot
 * filter-chain misconfiguration before it shows up as poor performance.
 */
export class SignalConversionPanelDto {
  @ApiProperty({ description: 'Total signals emitted', example: 190502 })
  totalSignals: number;

  @ApiProperty({ description: 'Signals that resulted in placed/simulated trades', example: 568 })
  placedSignals: number;

  @ApiProperty({ description: 'Signals rejected/blocked/failed', example: 189934 })
  rejectedSignals: number;

  @ApiProperty({ description: 'Conversion percentage (placed / total * 100)', example: 0.3 })
  conversionPct: number;

  @ApiProperty({
    description: 'Top 5 rejection reasons sorted by count descending',
    type: [SignalRejectionReasonDto]
  })
  topRejectionReasons: SignalRejectionReasonDto[];
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

  @ApiProperty({ description: 'Signal → trade conversion metrics' })
  signalConversion: SignalConversionPanelDto;
}
