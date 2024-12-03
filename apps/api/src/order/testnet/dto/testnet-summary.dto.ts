import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsString } from 'class-validator';

export enum TestnetSummary {
  '30m' = '30m',
  '1h' = '1h',
  '6h' = '6h',
  '12h' = '12h',
  '1d' = '1d',
  '7d' = '7d',
  '14d' = '14d',
  '30d' = '30d',
  '90d' = '90d',
  '180d' = '180d',
  '1y' = '1y',
  '5y' = '5y',
  'all' = 'all'
}

export enum TestnetSummaryDuration {
  '30m' = 30 * 60 * 1000,
  '1h' = 60 * 60 * 1000,
  '6h' = 6 * 60 * 60 * 1000,
  '12h' = 12 * 60 * 60 * 1000,
  '1d' = 24 * 60 * 60 * 1000,
  '7d' = 7 * 24 * 60 * 60 * 1000,
  '14d' = 14 * 24 * 60 * 60 * 1000,
  '30d' = 30 * 24 * 60 * 60 * 1000,
  '90d' = 90 * 24 * 60 * 60 * 1000,
  '180d' = 180 * 24 * 60 * 60 * 1000,
  '1y' = 365 * 24 * 60 * 60 * 1000,
  '5y' = 5 * 365 * 24 * 60 * 60 * 1000,
  'all' = new Date().getTime() // NOTE: This is a special case, 1970-01-01
}

export interface TestnetSummaryResponse {
  [coin: string]: {
    profitLoss: number;
    percentage: number;
    trades: number;
  };
}

export class TestnetSummaryDto {
  @IsString()
  @Transform(({ value }) => ('' + value).toLowerCase())
  @IsEnum(TestnetSummary, {
    message: `Invalid summary duration. Valid options: ${Object.values(TestnetSummary).join(', ')}`
  })
  @ApiProperty({
    description: 'Time duration for the summary',
    example: '1d',
    enum: TestnetSummary,
    required: true
  })
  duration: TestnetSummary;

  readonly response?: TestnetSummaryResponse;
}
