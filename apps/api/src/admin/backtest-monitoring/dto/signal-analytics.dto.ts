import { ApiProperty } from '@nestjs/swagger';

import { SignalDirection, SignalType } from '../../../order/backtest/backtest.entity';

/**
 * Overall signal statistics
 */
export class SignalOverallStatsDto {
  @ApiProperty({ description: 'Total number of signals' })
  totalSignals: number;

  @ApiProperty({ description: 'Count of entry signals' })
  entryCount: number;

  @ApiProperty({ description: 'Count of exit signals' })
  exitCount: number;

  @ApiProperty({ description: 'Count of adjustment signals' })
  adjustmentCount: number;

  @ApiProperty({ description: 'Count of risk control signals' })
  riskControlCount: number;

  @ApiProperty({ description: 'Average confidence across all signals (0-1 scale)', example: 0.72 })
  avgConfidence: number;
}

/**
 * Signal metrics by confidence bucket
 */
export class ConfidenceBucketDto {
  @ApiProperty({ description: 'Confidence bucket range', example: '60-80%' })
  bucket: string;

  @ApiProperty({ description: 'Number of signals in this bucket' })
  signalCount: number;

  @ApiProperty({ description: 'Success rate for signals in this bucket (0-1 scale)', example: 0.68 })
  successRate: number;

  @ApiProperty({ description: 'Average return for trades from signals in this bucket', example: 2.5 })
  avgReturn: number;
}

/**
 * Signal metrics by type
 */
export class SignalTypeMetricsDto {
  @ApiProperty({ description: 'Signal type', enum: SignalType })
  type: SignalType;

  @ApiProperty({ description: 'Number of signals of this type' })
  count: number;

  @ApiProperty({ description: 'Success rate for this signal type (0-1 scale)', example: 0.65 })
  successRate: number;

  @ApiProperty({ description: 'Average return for trades from this signal type', example: 1.8 })
  avgReturn: number;
}

/**
 * Signal metrics by direction
 */
export class SignalDirectionMetricsDto {
  @ApiProperty({ description: 'Signal direction', enum: SignalDirection })
  direction: SignalDirection;

  @ApiProperty({ description: 'Number of signals with this direction' })
  count: number;

  @ApiProperty({ description: 'Success rate for this direction (0-1 scale)', example: 0.62 })
  successRate: number;

  @ApiProperty({ description: 'Average return for trades with this direction', example: 2.1 })
  avgReturn: number;
}

/**
 * Signal metrics by instrument/symbol
 */
export class SignalInstrumentMetricsDto {
  @ApiProperty({ description: 'Instrument/symbol name', example: 'BTC/USDT' })
  instrument: string;

  @ApiProperty({ description: 'Number of signals for this instrument' })
  count: number;

  @ApiProperty({ description: 'Success rate for this instrument (0-1 scale)', example: 0.7 })
  successRate: number;

  @ApiProperty({ description: 'Average return for trades on this instrument', example: 3.2 })
  avgReturn: number;
}

/**
 * Complete signal analytics response
 */
export class SignalAnalyticsDto {
  @ApiProperty({ description: 'Overall signal statistics' })
  overall: SignalOverallStatsDto;

  @ApiProperty({ description: 'Signal metrics grouped by confidence bucket', type: [ConfidenceBucketDto] })
  byConfidenceBucket: ConfidenceBucketDto[];

  @ApiProperty({ description: 'Signal metrics grouped by signal type', type: [SignalTypeMetricsDto] })
  bySignalType: SignalTypeMetricsDto[];

  @ApiProperty({ description: 'Signal metrics grouped by direction', type: [SignalDirectionMetricsDto] })
  byDirection: SignalDirectionMetricsDto[];

  @ApiProperty({ description: 'Signal metrics grouped by instrument (top 10)', type: [SignalInstrumentMetricsDto] })
  byInstrument: SignalInstrumentMetricsDto[];
}
