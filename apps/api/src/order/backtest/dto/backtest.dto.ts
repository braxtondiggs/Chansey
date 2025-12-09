import { ApiProperty } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import {
  IsDateString,
  IsArray,
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

import {
  BacktestStatus,
  BacktestType,
  SignalDirection,
  SignalType,
  SimulatedOrderStatus,
  SimulatedOrderType
} from '../backtest.entity';

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

  @IsUUID('4')
  @IsNotEmpty()
  @ApiProperty({
    description: 'UUID of the market data set used for the run',
    example: '21dbce1f-9a0e-4f3b-b9f6-6b69b9d5d0f1'
  })
  marketDataSetId: string;

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

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Deterministic seed used to reproduce the run',
    example: 'run-seed-20250101',
    required: false
  })
  deterministicSeed?: string;
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

  @IsEnum(BacktestType)
  @IsOptional()
  @ApiProperty({
    description: 'Filter by backtest mode',
    enum: BacktestType,
    required: false
  })
  mode?: BacktestType;

  @IsUUID('4')
  @IsOptional()
  @ApiProperty({
    description: 'Filter by algorithm ID',
    required: false
  })
  algorithmId?: string;

  @IsEnum(BacktestStatus)
  @IsOptional()
  @ApiProperty({
    description: 'Filter by run status',
    enum: BacktestStatus,
    required: false
  })
  status?: BacktestStatus;

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
    maximum: 200,
    default: 50,
    required: false
  })
  limit?: number = 50;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Opaque cursor for pagination',
    required: false
  })
  cursor?: string;
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

export class ComparisonFiltersDto {
  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'Timeframe filter label', required: false })
  timeframe?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'Market regime filter', required: false })
  marketRegime?: string;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  @ApiProperty({ description: 'Subset of algorithm IDs included', required: false, type: [String] })
  algorithmIds?: string[];
}

export class CreateComparisonReportDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'Name of the comparison report' })
  name: string;

  @IsUUID('4', { each: true })
  @IsNotEmpty()
  @ApiProperty({
    description: 'Run identifiers to include in the report',
    example: ['uuid1', 'uuid2'],
    type: [String]
  })
  runIds: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ComparisonFiltersDto)
  @ApiProperty({ description: 'Filters captured at report creation', required: false })
  filters?: ComparisonFiltersDto;
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

export class BacktestSignalQueryDto {
  @IsOptional()
  @IsString()
  @ApiProperty({ description: 'Opaque cursor for pagination', required: false })
  cursor?: string;

  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(500)
  @Type(() => Number)
  @ApiProperty({ description: 'Number of signals to return', minimum: 10, maximum: 500, default: 100, required: false })
  pageSize?: number = 100;

  @IsOptional()
  @IsString()
  @ApiProperty({ description: 'Filter by instrument symbol', required: false })
  instrument?: string;

  @IsOptional()
  @IsEnum(SignalType)
  @ApiProperty({ description: 'Filter by signal type', enum: SignalType, required: false })
  signalType?: SignalType;

  @IsOptional()
  @IsEnum(SignalDirection)
  @ApiProperty({ description: 'Filter by direction', enum: SignalDirection, required: false })
  direction?: SignalDirection;
}

export class BacktestTradesQueryDto {
  @IsOptional()
  @IsString()
  @ApiProperty({ description: 'Opaque cursor for pagination', required: false })
  cursor?: string;

  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(500)
  @Type(() => Number)
  @ApiProperty({ description: 'Number of fills to return', minimum: 10, maximum: 500, default: 100, required: false })
  pageSize?: number = 100;

  @IsOptional()
  @IsEnum(SimulatedOrderType)
  @ApiProperty({ description: 'Filter by simulated order type', enum: SimulatedOrderType, required: false })
  orderType?: SimulatedOrderType;

  @IsOptional()
  @IsEnum(SimulatedOrderStatus)
  @ApiProperty({ description: 'Filter by simulated order status', enum: SimulatedOrderStatus, required: false })
  status?: SimulatedOrderStatus;

  @IsOptional()
  @IsString()
  @ApiProperty({ description: 'Filter by instrument symbol', required: false })
  instrument?: string;
}
