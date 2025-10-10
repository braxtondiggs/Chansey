import { ApiPropertyOptional } from '@nestjs/swagger';

import { IsDateString, IsEnum, IsOptional } from 'class-validator';

export enum PerformancePeriod {
  TWENTY_FOUR_H = '24h',
  SEVEN_D = '7d',
  THIRTY_D = '30d',
  NINETY_D = '90d',
  ALL = 'all'
}

export enum PerformanceInterval {
  FIVE_M = '5m',
  ONE_H = '1h',
  ONE_D = '1d'
}

export class AlgorithmPerformanceQueryDto {
  @IsOptional()
  @IsEnum(PerformancePeriod)
  @ApiPropertyOptional({
    enum: PerformancePeriod,
    example: PerformancePeriod.THIRTY_D,
    default: PerformancePeriod.THIRTY_D,
    description: 'Time period for metrics calculation'
  })
  period?: PerformancePeriod;

  @IsOptional()
  @IsDateString()
  @ApiPropertyOptional({
    example: '2025-09-01T00:00:00Z',
    description: 'Start date for history (defaults to 30 days ago)'
  })
  from?: string;

  @IsOptional()
  @IsDateString()
  @ApiPropertyOptional({
    example: '2025-09-30T23:59:59Z',
    description: 'End date for history (defaults to now)'
  })
  to?: string;

  @IsOptional()
  @IsEnum(PerformanceInterval)
  @ApiPropertyOptional({
    enum: PerformanceInterval,
    example: PerformanceInterval.ONE_H,
    default: PerformanceInterval.ONE_H,
    description: 'Data point interval for historical data'
  })
  interval?: PerformanceInterval;
}
