import { ApiProperty } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

import { PaperTradingOrderSide, PaperTradingOrderStatus } from '../entities/paper-trading-order.entity';
import { PaperTradingStatus } from '../entities/paper-trading-session.entity';
import { PaperTradingSignalDirection, PaperTradingSignalType } from '../entities/paper-trading-signal.entity';

export class PaperTradingSessionFiltersDto {
  @IsEnum(PaperTradingStatus)
  @IsOptional()
  @ApiProperty({
    description: 'Filter by session status',
    enum: PaperTradingStatus,
    required: false
  })
  status?: PaperTradingStatus;

  @IsUUID('4')
  @IsOptional()
  @ApiProperty({
    description: 'Filter by algorithm ID',
    required: false
  })
  algorithmId?: string;

  @IsUUID('4')
  @IsOptional()
  @ApiProperty({
    description: 'Filter by pipeline ID',
    required: false
  })
  pipelineId?: string;

  @IsDateString()
  @IsOptional()
  @ApiProperty({
    description: 'Filter sessions created after this date',
    required: false
  })
  createdAfter?: string;

  @IsDateString()
  @IsOptional()
  @ApiProperty({
    description: 'Filter sessions created before this date',
    required: false
  })
  createdBefore?: string;

  @IsNumber()
  @Min(1)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  @ApiProperty({
    description: 'Number of results to return',
    minimum: 1,
    maximum: 100,
    default: 50,
    required: false
  })
  limit?: number = 50;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  @ApiProperty({
    description: 'Offset for pagination',
    minimum: 0,
    default: 0,
    required: false
  })
  offset?: number = 0;
}

export class PaperTradingOrderFiltersDto {
  @IsEnum(PaperTradingOrderStatus)
  @IsOptional()
  @ApiProperty({
    description: 'Filter by order status',
    enum: PaperTradingOrderStatus,
    required: false
  })
  status?: PaperTradingOrderStatus;

  @IsEnum(PaperTradingOrderSide)
  @IsOptional()
  @ApiProperty({
    description: 'Filter by order side',
    enum: PaperTradingOrderSide,
    required: false
  })
  side?: PaperTradingOrderSide;

  @IsString()
  @Matches(/^[A-Z0-9]{2,10}\/[A-Z0-9]{2,10}$/, {
    message: 'Symbol must be in format BASE/QUOTE (e.g., BTC/USD, ETH/USDT)'
  })
  @IsOptional()
  @ApiProperty({
    description: 'Filter by symbol (format: BASE/QUOTE, e.g., BTC/USD)',
    example: 'BTC/USD',
    required: false
  })
  symbol?: string;

  @IsNumber()
  @Min(1)
  @Max(500)
  @IsOptional()
  @Type(() => Number)
  @ApiProperty({
    description: 'Number of results to return',
    minimum: 1,
    maximum: 500,
    default: 100,
    required: false
  })
  limit?: number = 100;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  @ApiProperty({
    description: 'Offset for pagination',
    minimum: 0,
    default: 0,
    required: false
  })
  offset?: number = 0;
}

export class PaperTradingSignalFiltersDto {
  @IsEnum(PaperTradingSignalType)
  @IsOptional()
  @ApiProperty({
    description: 'Filter by signal type',
    enum: PaperTradingSignalType,
    required: false
  })
  signalType?: PaperTradingSignalType;

  @IsEnum(PaperTradingSignalDirection)
  @IsOptional()
  @ApiProperty({
    description: 'Filter by signal direction',
    enum: PaperTradingSignalDirection,
    required: false
  })
  direction?: PaperTradingSignalDirection;

  @IsString()
  @Matches(/^[A-Z0-9]{2,10}\/[A-Z0-9]{2,10}$/, {
    message: 'Instrument must be in format BASE/QUOTE (e.g., BTC/USD, ETH/USDT)'
  })
  @IsOptional()
  @ApiProperty({
    description: 'Filter by instrument (format: BASE/QUOTE, e.g., BTC/USD)',
    example: 'BTC/USD',
    required: false
  })
  instrument?: string;

  @IsOptional()
  @Type(() => Boolean)
  @ApiProperty({
    description: 'Filter by processed status',
    required: false
  })
  processed?: boolean;

  @IsNumber()
  @Min(1)
  @Max(500)
  @IsOptional()
  @Type(() => Number)
  @ApiProperty({
    description: 'Number of results to return',
    minimum: 1,
    maximum: 500,
    default: 100,
    required: false
  })
  limit?: number = 100;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  @ApiProperty({
    description: 'Offset for pagination',
    minimum: 0,
    default: 0,
    required: false
  })
  offset?: number = 0;
}

export class PaperTradingSnapshotFiltersDto {
  @IsDateString()
  @IsOptional()
  @ApiProperty({
    description: 'Filter snapshots after this timestamp',
    required: false
  })
  after?: string;

  @IsDateString()
  @IsOptional()
  @ApiProperty({
    description: 'Filter snapshots before this timestamp',
    required: false
  })
  before?: string;

  @IsNumber()
  @Min(1)
  @Max(1000)
  @IsOptional()
  @Type(() => Number)
  @ApiProperty({
    description: 'Number of results to return',
    minimum: 1,
    maximum: 1000,
    default: 200,
    required: false
  })
  limit?: number = 200;
}
