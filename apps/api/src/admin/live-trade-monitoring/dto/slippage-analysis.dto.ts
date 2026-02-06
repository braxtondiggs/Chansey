import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Slippage statistics
 */
export class LiveSlippageStatsDto {
  @ApiProperty({ description: 'Average slippage in basis points', example: 12.5 })
  avgBps: number;

  @ApiProperty({ description: 'Median slippage in basis points', example: 10.0 })
  medianBps: number;

  @ApiProperty({ description: 'Minimum slippage in basis points', example: 0.5 })
  minBps: number;

  @ApiProperty({ description: 'Maximum slippage in basis points', example: 75.0 })
  maxBps: number;

  @ApiProperty({ description: '95th percentile slippage', example: 35.0 })
  p95Bps: number;

  @ApiProperty({ description: 'Standard deviation of slippage', example: 8.5 })
  stdDevBps: number;

  @ApiProperty({ description: 'Number of orders analyzed', example: 500 })
  orderCount: number;
}

/**
 * Slippage by algorithm
 */
export class SlippageByAlgorithmDto {
  @ApiProperty({ description: 'Algorithm ID' })
  algorithmId: string;

  @ApiProperty({ description: 'Algorithm name' })
  algorithmName: string;

  @ApiProperty({ description: 'Live trading slippage stats' })
  liveSlippage: LiveSlippageStatsDto;

  @ApiPropertyOptional({ description: 'Backtest slippage stats (from SimulatedOrderFill)' })
  backtestSlippage?: LiveSlippageStatsDto;

  @ApiProperty({ description: 'Difference between live and backtest average (bps)', example: 5.5 })
  slippageDifferenceBps: number;
}

/**
 * Slippage by time of day
 */
export class SlippageByTimeDto {
  @ApiProperty({ description: 'Hour of day (0-23)', example: 14 })
  hour: number;

  @ApiProperty({ description: 'Average slippage for this hour', example: 15.2 })
  avgBps: number;

  @ApiProperty({ description: 'Number of orders in this hour', example: 45 })
  orderCount: number;
}

/**
 * Slippage by order size bucket
 */
export class SlippageBySizeDto {
  @ApiProperty({ description: 'Size bucket label', example: '$1000-$5000' })
  bucket: string;

  @ApiProperty({ description: 'Minimum order size in USD', example: 1000 })
  minSize: number;

  @ApiProperty({ description: 'Maximum order size in USD', example: 5000 })
  maxSize: number;

  @ApiProperty({ description: 'Average slippage for this bucket', example: 18.5 })
  avgBps: number;

  @ApiProperty({ description: 'Number of orders in this bucket', example: 120 })
  orderCount: number;
}

/**
 * Slippage by symbol
 */
export class SlippageBySymbolDto {
  @ApiProperty({ description: 'Trading pair symbol', example: 'BTC/USDT' })
  symbol: string;

  @ApiProperty({ description: 'Average slippage for this symbol', example: 8.5 })
  avgBps: number;

  @ApiProperty({ description: 'Number of orders for this symbol', example: 200 })
  orderCount: number;

  @ApiProperty({ description: 'Total volume for this symbol', example: 150000 })
  totalVolume: number;
}

/**
 * Complete slippage analysis response
 */
export class SlippageAnalysisDto {
  @ApiProperty({ description: 'Overall live trading slippage statistics' })
  overallLive: LiveSlippageStatsDto;

  @ApiPropertyOptional({ description: 'Overall backtest slippage statistics' })
  overallBacktest?: LiveSlippageStatsDto;

  @ApiProperty({ description: 'Difference between live and backtest average (bps)', example: 5.5 })
  overallDifferenceBps: number;

  @ApiProperty({ description: 'Slippage breakdown by algorithm', type: [SlippageByAlgorithmDto] })
  byAlgorithm: SlippageByAlgorithmDto[];

  @ApiProperty({ description: 'Slippage breakdown by hour of day', type: [SlippageByTimeDto] })
  byTimeOfDay: SlippageByTimeDto[];

  @ApiProperty({ description: 'Slippage breakdown by order size', type: [SlippageBySizeDto] })
  byOrderSize: SlippageBySizeDto[];

  @ApiProperty({ description: 'Slippage breakdown by symbol', type: [SlippageBySymbolDto] })
  bySymbol: SlippageBySymbolDto[];

  @ApiProperty({ description: 'Analysis period start date' })
  periodStart: string;

  @ApiProperty({ description: 'Analysis period end date' })
  periodEnd: string;
}
