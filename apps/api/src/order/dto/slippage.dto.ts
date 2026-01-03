import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsEnum, IsNumber, IsOptional, Max, Min } from 'class-validator';

export enum SlippagePeriod {
  SEVEN_DAYS = '7d',
  THIRTY_DAYS = '30d',
  NINETY_DAYS = '90d'
}

export class SlippageQueryDto {
  @IsEnum(SlippagePeriod)
  @IsOptional()
  @ApiPropertyOptional({
    description: 'Time period for trend analysis',
    enum: SlippagePeriod,
    default: SlippagePeriod.THIRTY_DAYS
  })
  period?: SlippagePeriod = SlippagePeriod.THIRTY_DAYS;

  @IsNumber()
  @Min(1)
  @Max(500)
  @IsOptional()
  @ApiPropertyOptional({
    description: 'Threshold in basis points for high slippage classification',
    default: 50,
    minimum: 1,
    maximum: 500
  })
  thresholdBps?: number = 50;
}

export class SlippageStatsDto {
  @ApiProperty({ description: 'Trading pair symbol', example: 'BTC/USDT' })
  symbol: string;

  @ApiProperty({ description: 'Average slippage in basis points', example: 12.5 })
  avgSlippageBps: number;

  @ApiProperty({ description: 'Minimum slippage in basis points', example: -5.2 })
  minSlippageBps: number;

  @ApiProperty({ description: 'Maximum slippage in basis points', example: 45.8 })
  maxSlippageBps: number;

  @ApiProperty({ description: 'Standard deviation of slippage', example: 8.3 })
  stdDevBps: number;

  @ApiProperty({ description: 'Total number of orders analyzed', example: 150 })
  orderCount: number;

  @ApiProperty({ description: 'Orders with favorable slippage (negative)', example: 45 })
  favorableCount: number;

  @ApiProperty({ description: 'Orders with unfavorable slippage (positive)', example: 105 })
  unfavorableCount: number;
}

export class SlippageTrendDto {
  @ApiProperty({ description: 'Date of the data point', example: '2024-01-15' })
  date: string;

  @ApiProperty({ description: 'Average slippage for this date in basis points', example: 15.2 })
  avgSlippageBps: number;

  @ApiProperty({ description: 'Number of orders on this date', example: 12 })
  orderCount: number;
}

export class SlippageSummaryDto {
  @ApiProperty({ description: 'Total orders with slippage data', example: 500 })
  totalOrders: number;

  @ApiProperty({ description: 'Overall average slippage in basis points', example: 18.5 })
  avgSlippageBps: number;

  @ApiProperty({ description: 'Maximum slippage observed in basis points', example: 125.0 })
  maxSlippageBps: number;

  @ApiProperty({ description: 'Total USD cost due to slippage', example: 245.5 })
  totalSlippageCostUsd: number;

  @ApiProperty({ description: 'Number of orders with slippage > 50 bps', example: 15 })
  highSlippageOrderCount: number;
}
