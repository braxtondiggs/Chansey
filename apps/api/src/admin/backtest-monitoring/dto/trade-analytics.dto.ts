import { ApiProperty } from '@nestjs/swagger';

/**
 * Trade summary statistics
 */
export class TradeSummaryDto {
  @ApiProperty({ description: 'Total number of trades' })
  totalTrades: number;

  @ApiProperty({ description: 'Total trading volume in USD' })
  totalVolume: number;

  @ApiProperty({ description: 'Total fees paid in USD' })
  totalFees: number;

  @ApiProperty({ description: 'Number of buy trades' })
  buyCount: number;

  @ApiProperty({ description: 'Number of sell trades' })
  sellCount: number;
}

/**
 * Profitability statistics
 */
export class ProfitabilityStatsDto {
  @ApiProperty({ description: 'Number of winning trades' })
  winCount: number;

  @ApiProperty({ description: 'Number of losing trades' })
  lossCount: number;

  @ApiProperty({ description: 'Win rate (0-1 scale)', example: 0.65 })
  winRate: number;

  @ApiProperty({ description: 'Profit factor (gross profit / gross loss)', example: 1.85 })
  profitFactor: number;

  @ApiProperty({ description: 'Largest winning trade in USD', example: 1500.25 })
  largestWin: number;

  @ApiProperty({ description: 'Largest losing trade in USD', example: -800.5 })
  largestLoss: number;

  @ApiProperty({
    description: 'Expected value per trade (avg win * win rate - avg loss * loss rate)',
    example: 45.3
  })
  expectancy: number;

  @ApiProperty({ description: 'Average profit on winning trades', example: 250.75 })
  avgWin: number;

  @ApiProperty({ description: 'Average loss on losing trades', example: -125.3 })
  avgLoss: number;

  @ApiProperty({ description: 'Total realized profit/loss in USD' })
  totalRealizedPnL: number;
}

/**
 * Trade duration statistics
 */
export class TradeDurationStatsDto {
  @ApiProperty({ description: 'Average hold time in milliseconds' })
  avgHoldTimeMs: number;

  @ApiProperty({ description: 'Average hold time formatted', example: '2h 15m' })
  avgHoldTime: string;

  @ApiProperty({ description: 'Median hold time in milliseconds' })
  medianHoldTimeMs: number;

  @ApiProperty({ description: 'Median hold time formatted', example: '1h 45m' })
  medianHoldTime: string;

  @ApiProperty({ description: 'Maximum hold time in milliseconds' })
  maxHoldTimeMs: number;

  @ApiProperty({ description: 'Maximum hold time formatted', example: '5d 3h' })
  maxHoldTime: string;

  @ApiProperty({ description: 'Minimum hold time in milliseconds' })
  minHoldTimeMs: number;

  @ApiProperty({ description: 'Minimum hold time formatted', example: '5m' })
  minHoldTime: string;
}

/**
 * Slippage statistics
 */
export class SlippageStatsDto {
  @ApiProperty({ description: 'Average slippage in basis points', example: 5.2 })
  avgBps: number;

  @ApiProperty({ description: 'Total slippage impact in USD', example: 450.75 })
  totalImpact: number;

  @ApiProperty({ description: '95th percentile slippage in basis points', example: 15.8 })
  p95Bps: number;

  @ApiProperty({ description: 'Maximum slippage in basis points', example: 25.3 })
  maxBps: number;

  @ApiProperty({ description: 'Number of fills with slippage data' })
  fillCount: number;
}

/**
 * Trade metrics by instrument
 */
export class InstrumentTradeMetricsDto {
  @ApiProperty({ description: 'Instrument/symbol name', example: 'BTC/USDT' })
  instrument: string;

  @ApiProperty({ description: 'Number of trades on this instrument' })
  tradeCount: number;

  @ApiProperty({ description: 'Total return percentage for this instrument', example: 12.5 })
  totalReturn: number;

  @ApiProperty({ description: 'Win rate for this instrument (0-1 scale)', example: 0.68 })
  winRate: number;

  @ApiProperty({ description: 'Total volume traded on this instrument', example: 50000 })
  totalVolume: number;

  @ApiProperty({ description: 'Total realized P&L for this instrument', example: 1250.5 })
  totalPnL: number;
}

/**
 * Complete trade analytics response
 */
export class TradeAnalyticsDto {
  @ApiProperty({ description: 'Trade summary statistics' })
  summary: TradeSummaryDto;

  @ApiProperty({ description: 'Profitability statistics' })
  profitability: ProfitabilityStatsDto;

  @ApiProperty({ description: 'Trade duration statistics' })
  duration: TradeDurationStatsDto;

  @ApiProperty({ description: 'Slippage statistics from simulated fills' })
  slippage: SlippageStatsDto;

  @ApiProperty({ description: 'Trade metrics by instrument (top 10)', type: [InstrumentTradeMetricsDto] })
  byInstrument: InstrumentTradeMetricsDto[];
}
