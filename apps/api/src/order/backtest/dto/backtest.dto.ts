import { ApiProperty } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  Max,
  ValidateNested
} from 'class-validator';

import { BacktestType } from '../backtest.entity';

export class CreateBacktestDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'Name for the backtest run',
    example: 'Moving Average Crossover - BTC/USD - Q4 2023'
  })
  name: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Description of the backtest strategy',
    example: 'Testing 50/200 day moving average crossover strategy on Bitcoin',
    required: false
  })
  description?: string;

  @IsEnum(BacktestType)
  @IsNotEmpty()
  @ApiProperty({
    description: 'Type of backtest to run',
    enum: BacktestType,
    example: BacktestType.HISTORICAL
  })
  type: BacktestType;

  @IsUUID('4')
  @IsNotEmpty()
  @ApiProperty({
    description: 'UUID of the algorithm to use for backtesting',
    example: '100c1721-7b0b-4d96-a18e-40904c0cc36b'
  })
  algorithmId: string;

  @IsNumber()
  @Min(100)
  @ApiProperty({
    description: 'Initial capital in USD for the backtest',
    example: 10000,
    minimum: 100
  })
  initialCapital: number;

  @IsNumber()
  @Min(0)
  @Max(0.1)
  @IsOptional()
  @ApiProperty({
    description: 'Trading fee percentage (e.g., 0.001 = 0.1%)',
    example: 0.001,
    default: 0.001,
    minimum: 0,
    maximum: 0.1,
    required: false
  })
  tradingFee?: number;

  @IsDateString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'Start date for historical backtest (ISO string)',
    example: '2023-01-01T00:00:00.000Z'
  })
  startDate: string;

  @IsDateString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'End date for historical backtest (ISO string)',
    example: '2023-12-31T23:59:59.000Z'
  })
  endDate: string;

  @IsOptional()
  @ApiProperty({
    description: 'Strategy-specific parameters',
    example: {
      fastPeriod: 50,
      slowPeriod: 200,
      stopLoss: 0.05,
      takeProfit: 0.15
    },
    required: false
  })
  strategyParams?: Record<string, any>;
}

export class UpdateBacktestDto {
  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Name for the backtest run',
    required: false
  })
  name?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Description of the backtest strategy',
    required: false
  })
  description?: string;

  @IsOptional()
  @ApiProperty({
    description: 'Strategy-specific parameters',
    required: false
  })
  strategyParams?: Record<string, any>;
}

export class BacktestFiltersDto {
  @IsEnum(BacktestType)
  @IsOptional()
  @ApiProperty({
    description: 'Filter by backtest type',
    enum: BacktestType,
    required: false
  })
  type?: BacktestType;

  @IsUUID('4')
  @IsOptional()
  @ApiProperty({
    description: 'Filter by algorithm ID',
    required: false
  })
  algorithmId?: string;

  @IsDateString()
  @IsOptional()
  @ApiProperty({
    description: 'Filter backtests created after this date',
    required: false
  })
  createdAfter?: string;

  @IsDateString()
  @IsOptional()
  @ApiProperty({
    description: 'Filter backtests created before this date',
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
    default: 20,
    required: false
  })
  limit?: number = 20;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  @ApiProperty({
    description: 'Number of results to skip',
    minimum: 0,
    default: 0,
    required: false
  })
  offset?: number = 0;
}

export class BacktestPerformanceDto {
  @ApiProperty({ description: 'Backtest ID' })
  backtestId: string;

  @ApiProperty({ description: 'Backtest name' })
  name: string;

  @ApiProperty({ description: 'Initial capital' })
  initialCapital: number;

  @ApiProperty({ description: 'Final portfolio value' })
  finalValue: number;

  @ApiProperty({ description: 'Total return percentage' })
  totalReturn: number;

  @ApiProperty({ description: 'Annualized return percentage' })
  annualizedReturn: number;

  @ApiProperty({ description: 'Sharpe ratio' })
  sharpeRatio: number;

  @ApiProperty({ description: 'Maximum drawdown percentage' })
  maxDrawdown: number;

  @ApiProperty({ description: 'Total number of trades' })
  totalTrades: number;

  @ApiProperty({ description: 'Number of winning trades' })
  winningTrades: number;

  @ApiProperty({ description: 'Win rate percentage' })
  winRate: number;

  @ApiProperty({ description: 'Performance over time', type: [Object] })
  performanceHistory: Array<{
    timestamp: Date;
    portfolioValue: number;
    cumulativeReturn: number;
    drawdown: number;
  }>;

  @ApiProperty({ description: 'Recent trades', type: [Object] })
  recentTrades: Array<{
    id: string;
    type: string;
    quantity: number;
    price: number;
    totalValue: number;
    executedAt: Date;
    baseCoin: { symbol: string; name: string };
    quoteCoin: { symbol: string; name: string };
  }>;
}

export class BacktestComparisonDto {
  @IsUUID('4', { each: true })
  @IsNotEmpty()
  @ApiProperty({
    description: 'Array of backtest IDs to compare',
    example: ['uuid1', 'uuid2', 'uuid3'],
    type: [String]
  })
  backtestIds: string[];
}

export class BacktestProgressDto {
  @ApiProperty({ description: 'Current progress percentage (0-100)' })
  progress: number;

  @ApiProperty({ description: 'Current status message' })
  message: string;

  @ApiProperty({ description: 'Estimated time remaining in seconds', required: false })
  estimatedTimeRemaining?: number;

  @ApiProperty({ description: 'Current date being processed', required: false })
  currentDate?: Date;

  @ApiProperty({ description: 'Number of trades executed so far', required: false })
  tradesExecuted?: number;
}
