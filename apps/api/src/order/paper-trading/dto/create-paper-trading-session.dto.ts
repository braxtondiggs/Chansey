import { BadRequestException } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';

import { Transform, Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested
} from 'class-validator';

import { sanitizeObject } from '../../../utils/sanitize.util';

const MAX_ALGORITHM_CONFIG_SIZE = 10000; // Maximum JSON string size in bytes
const MAX_CONFIG_DEPTH = 5; // Maximum nesting depth for algorithm config
const MAX_CONFIG_KEYS = 50; // Maximum number of keys per object level

export class StopConditionsDto {
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(1)
  @ApiProperty({
    description: 'Stop if drawdown exceeds this value (e.g., 0.15 = 15%)',
    example: 0.15,
    minimum: 0,
    maximum: 1,
    required: false
  })
  maxDrawdown?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @ApiProperty({
    description: 'Stop if target return reached (e.g., 0.20 = 20%)',
    example: 0.2,
    minimum: 0,
    required: false
  })
  targetReturn?: number;
}

export class CreatePaperTradingSessionDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'Name for the paper trading session',
    example: 'BTC Momentum Strategy - Live Test'
  })
  name: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Description of the paper trading session',
    example: 'Testing momentum strategy with optimized parameters from backtest',
    required: false
  })
  description?: string;

  @IsUUID('4')
  @IsNotEmpty()
  @ApiProperty({
    description: 'UUID of the algorithm to use for paper trading',
    example: '100c1721-7b0b-4d96-a18e-40904c0cc36b'
  })
  algorithmId: string;

  @IsUUID('4')
  @IsNotEmpty()
  @ApiProperty({
    description: 'UUID of the exchange key for market data access',
    example: '21dbce1f-9a0e-4f3b-b9f6-6b69b9d5d0f1'
  })
  exchangeKeyId: string;

  @IsNumber()
  @Min(100)
  @ApiProperty({
    description: 'Initial capital in USD for paper trading',
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

  @IsNumber()
  @Min(5000)
  @Max(300000)
  @IsOptional()
  @ApiProperty({
    description: 'Interval between market data ticks in milliseconds',
    example: 30000,
    default: 30000,
    minimum: 5000,
    maximum: 300000,
    required: false
  })
  tickIntervalMs?: number;

  @IsString()
  @IsOptional()
  @Matches(/^(\d+)([smhdwMy])$/, {
    message: 'Duration must be in format like 30s, 5m, 1h, 7d, 2w, 3M, 1y'
  })
  @ApiProperty({
    description: 'Auto-stop duration (e.g., 30s, 5m, 1h, 7d, 2w, 3M, 1y)',
    example: '7d',
    required: false
  })
  duration?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => StopConditionsDto)
  @ApiProperty({
    description: 'Conditions for auto-stopping the session',
    type: StopConditionsDto,
    required: false
  })
  stopConditions?: StopConditionsDto;

  @IsObject()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return value;

    // Sanitize the object to prevent prototype pollution and enforce limits
    let sanitized: Record<string, unknown>;
    try {
      sanitized = sanitizeObject(value, {
        maxDepth: MAX_CONFIG_DEPTH,
        maxKeys: MAX_CONFIG_KEYS,
        allowedTypes: ['string', 'number', 'boolean', 'null'],
        maxStringLength: 1000,
        allowArrays: true,
        maxArrayLength: 100
      });
    } catch (error) {
      throw new BadRequestException(`Invalid algorithmConfig: ${error.message}`);
    }

    // Check total serialized size
    const jsonString = JSON.stringify(sanitized);
    if (jsonString.length > MAX_ALGORITHM_CONFIG_SIZE) {
      throw new BadRequestException(
        `algorithmConfig exceeds maximum size of ${MAX_ALGORITHM_CONFIG_SIZE} bytes (got ${jsonString.length})`
      );
    }
    return sanitized;
  })
  @ApiProperty({
    description: 'Algorithm configuration/parameters (max 10KB, max depth 5)',
    example: {
      fastPeriod: 12,
      slowPeriod: 26,
      riskPerTrade: 0.02
    },
    required: false
  })
  algorithmConfig?: Record<string, number | string | boolean | null>;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Quote currency for trades (e.g., USD, USDT)',
    example: 'USD',
    default: 'USD',
    required: false
  })
  quoteCurrency?: string;
}

export class UpdatePaperTradingSessionDto {
  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Name for the paper trading session',
    required: false
  })
  name?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Description of the paper trading session',
    required: false
  })
  description?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => StopConditionsDto)
  @ApiProperty({
    description: 'Conditions for auto-stopping the session',
    type: StopConditionsDto,
    required: false
  })
  stopConditions?: StopConditionsDto;

  @IsObject()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return value;

    // Sanitize the object to prevent prototype pollution and enforce limits
    let sanitized: Record<string, unknown>;
    try {
      sanitized = sanitizeObject(value, {
        maxDepth: MAX_CONFIG_DEPTH,
        maxKeys: MAX_CONFIG_KEYS,
        allowedTypes: ['string', 'number', 'boolean', 'null'],
        maxStringLength: 1000,
        allowArrays: true,
        maxArrayLength: 100
      });
    } catch (error) {
      throw new BadRequestException(`Invalid algorithmConfig: ${error.message}`);
    }

    // Check total serialized size
    const jsonString = JSON.stringify(sanitized);
    if (jsonString.length > MAX_ALGORITHM_CONFIG_SIZE) {
      throw new BadRequestException(
        `algorithmConfig exceeds maximum size of ${MAX_ALGORITHM_CONFIG_SIZE} bytes (got ${jsonString.length})`
      );
    }
    return sanitized;
  })
  @ApiProperty({
    description: 'Algorithm configuration/parameters (max 10KB, max depth 5)',
    required: false
  })
  algorithmConfig?: Record<string, number | string | boolean | null>;
}
