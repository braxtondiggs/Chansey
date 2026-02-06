import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Performance metrics that can be compared
 */
export class PerformanceMetricsDto {
  @ApiPropertyOptional({ description: 'Total return percentage', example: 15.5 })
  totalReturn?: number;

  @ApiPropertyOptional({ description: 'Sharpe ratio', example: 1.34 })
  sharpeRatio?: number;

  @ApiPropertyOptional({ description: 'Win rate (0-1 scale)', example: 0.65 })
  winRate?: number;

  @ApiPropertyOptional({ description: 'Maximum drawdown percentage', example: 12.3 })
  maxDrawdown?: number;

  @ApiPropertyOptional({ description: 'Total number of trades', example: 150 })
  totalTrades?: number;

  @ApiPropertyOptional({ description: 'Average slippage in basis points', example: 10.5 })
  avgSlippageBps?: number;

  @ApiPropertyOptional({ description: 'Total trading volume', example: 500000 })
  totalVolume?: number;

  @ApiPropertyOptional({ description: 'Volatility (standard deviation)', example: 0.15 })
  volatility?: number;
}

/**
 * Deviation metrics showing percentage difference between backtest and live
 */
export class DeviationMetricsDto {
  @ApiPropertyOptional({ description: 'Total return deviation (%)', example: -5.2 })
  totalReturn?: number;

  @ApiPropertyOptional({ description: 'Sharpe ratio deviation (%)', example: -10.5 })
  sharpeRatio?: number;

  @ApiPropertyOptional({ description: 'Win rate deviation (%)', example: -8.3 })
  winRate?: number;

  @ApiPropertyOptional({ description: 'Max drawdown deviation (%)', example: 25.0 })
  maxDrawdown?: number;

  @ApiPropertyOptional({ description: 'Average slippage deviation (bps)', example: 15.5 })
  avgSlippageBps?: number;
}

/**
 * Comparison between backtest and live performance for a specific algorithm
 */
export class AlgorithmComparisonDto {
  @ApiProperty({ description: 'Algorithm ID' })
  algorithmId: string;

  @ApiProperty({ description: 'Algorithm name' })
  algorithmName: string;

  @ApiProperty({ description: 'Number of active user activations' })
  activeActivations: number;

  @ApiProperty({ description: 'Total live orders' })
  totalLiveOrders: number;

  @ApiProperty({ description: 'Backtest ID used for comparison' })
  backtestId?: string;

  @ApiProperty({ description: 'Backtest name' })
  backtestName?: string;

  @ApiProperty({ description: 'Live performance metrics' })
  liveMetrics: PerformanceMetricsDto;

  @ApiPropertyOptional({ description: 'Backtest performance metrics' })
  backtestMetrics?: PerformanceMetricsDto;

  @ApiPropertyOptional({ description: 'Deviation between live and backtest (percentage difference)' })
  deviations?: DeviationMetricsDto;

  @ApiProperty({ description: 'Whether there is significant negative deviation', example: false })
  hasSignificantDeviation: boolean;

  @ApiProperty({ description: 'List of alerts for this comparison', type: [String] })
  alerts: string[];
}

/**
 * Full comparison response
 */
export class ComparisonDto {
  @ApiProperty({ description: 'Algorithm comparison data' })
  comparison: AlgorithmComparisonDto;

  @ApiProperty({ description: 'Comparison period start date' })
  periodStart: string;

  @ApiProperty({ description: 'Comparison period end date' })
  periodEnd: string;

  @ApiProperty({ description: 'When the comparison was calculated' })
  calculatedAt: string;
}
