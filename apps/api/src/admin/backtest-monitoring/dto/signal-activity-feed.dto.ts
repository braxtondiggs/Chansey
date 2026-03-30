import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { SignalReasonCode, SignalSource, SignalStatus } from '@chansey/api-interfaces';

import { SignalDirection, SignalType } from '../../../order/backtest/backtest.entity';

/**
 * A single signal in the activity feed
 */
export class SignalFeedItemDto {
  @ApiProperty({ description: 'Signal ID' })
  id: string;

  @ApiProperty({ description: 'When the signal was generated' })
  timestamp: string;

  @ApiProperty({ description: 'Signal type', enum: SignalType })
  signalType: SignalType;

  @ApiProperty({ description: 'Signal direction', enum: SignalDirection })
  direction: SignalDirection;

  @ApiProperty({ description: 'Target instrument/symbol' })
  instrument: string;

  @ApiProperty({ description: 'Quantity or exposure' })
  quantity: number;

  @ApiPropertyOptional({ description: 'Reference price' })
  price?: number;

  @ApiPropertyOptional({ description: 'Confidence score 0-1' })
  confidence?: number;

  @ApiProperty({ description: 'Signal status', enum: SignalStatus })
  status: SignalStatus;

  @ApiPropertyOptional({ description: 'Machine-readable signal reason code', enum: SignalReasonCode })
  reasonCode?: SignalReasonCode;

  @ApiPropertyOptional({ description: 'Human-readable reason' })
  reason?: string;

  @ApiProperty({ description: 'Signal source', enum: SignalSource })
  source: SignalSource;

  @ApiProperty({ description: 'Source entity ID (backtest or session ID)' })
  sourceId: string;

  @ApiProperty({ description: 'Source entity name (backtest name or session name)' })
  sourceName: string;

  @ApiProperty({ description: 'Algorithm name' })
  algorithmName: string;

  @ApiPropertyOptional({ description: 'User email' })
  userEmail?: string;

  @ApiPropertyOptional({ description: 'Whether signal was processed (paper trading only)' })
  processed?: boolean;
}

/**
 * Health summary for signal generation activity
 */
export class SignalHealthSummaryDto {
  @ApiPropertyOptional({ description: 'Timestamp of the most recent signal' })
  lastSignalTime?: string;

  @ApiPropertyOptional({ description: 'Milliseconds since the last signal' })
  lastSignalAgoMs?: number;

  @ApiProperty({ description: 'Number of signals in the last hour' })
  signalsLastHour: number;

  @ApiProperty({ description: 'Number of signals in the last 24 hours' })
  signalsLast24h: number;

  @ApiProperty({ description: 'Number of active backtest sources (RUNNING backtests)' })
  activeBacktestSources: number;

  @ApiProperty({ description: 'Number of active paper trading sources (ACTIVE sessions)' })
  activePaperTradingSources: number;

  @ApiProperty({ description: 'Total active sources' })
  totalActiveSources: number;
}

/**
 * Complete signal activity feed response
 */
export class SignalActivityFeedDto {
  @ApiProperty({ description: 'Health summary', type: SignalHealthSummaryDto })
  health: SignalHealthSummaryDto;

  @ApiProperty({ description: 'Recent signals', type: [SignalFeedItemDto] })
  signals: SignalFeedItemDto[];
}

/**
 * Query parameters for the signal activity feed
 */
export class SignalActivityFeedQueryDto {
  @ApiPropertyOptional({ description: 'Maximum number of signals to return (default 100, max 500)', default: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  @Type(() => Number)
  limit?: number = 100;
}
