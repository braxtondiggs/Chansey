import { ApiProperty } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateIf,
  ValidateNested
} from 'class-validator';

import {
  TrailingType as ExitTrailingType,
  StopLossType,
  TakeProfitType,
  TrailingActivationType
} from '../interfaces/exit-config.interface';
import { OrderSide, OrderType, TrailingType } from '../order.entity';

/**
 * DTO for exit configuration when placing manual orders
 */
export class ExitConfigDto {
  @IsOptional()
  @IsBoolean()
  @ApiProperty({
    description: 'Enable stop loss for this order',
    example: true,
    required: false
  })
  enableStopLoss?: boolean;

  @IsOptional()
  @IsEnum(StopLossType)
  @ApiProperty({
    enum: StopLossType,
    description: 'Stop loss type',
    example: StopLossType.PERCENTAGE,
    required: false
  })
  stopLossType?: StopLossType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Stop loss value (price, percentage, or ATR multiplier depending on type)',
    example: 2.5,
    required: false
  })
  stopLossValue?: number;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({
    description: 'Enable take profit for this order',
    example: true,
    required: false
  })
  enableTakeProfit?: boolean;

  @IsOptional()
  @IsEnum(TakeProfitType)
  @ApiProperty({
    enum: TakeProfitType,
    description: 'Take profit type',
    example: TakeProfitType.PERCENTAGE,
    required: false
  })
  takeProfitType?: TakeProfitType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Take profit value (price, percentage, or risk:reward ratio depending on type)',
    example: 5.0,
    required: false
  })
  takeProfitValue?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @ApiProperty({
    description: 'ATR period for ATR-based calculations',
    example: 14,
    required: false
  })
  atrPeriod?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @ApiProperty({
    description: 'ATR multiplier for ATR-based stop loss',
    example: 2.0,
    required: false
  })
  atrMultiplier?: number;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({
    description: 'Enable trailing stop for this order',
    example: false,
    required: false
  })
  enableTrailingStop?: boolean;

  @IsOptional()
  @IsEnum(ExitTrailingType)
  @ApiProperty({
    enum: ExitTrailingType,
    description: 'Trailing stop type',
    example: ExitTrailingType.PERCENTAGE,
    required: false
  })
  trailingType?: ExitTrailingType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Trailing stop value',
    example: 1.5,
    required: false
  })
  trailingValue?: number;

  @IsOptional()
  @IsEnum(TrailingActivationType)
  @ApiProperty({
    enum: TrailingActivationType,
    description: 'When to activate trailing stop',
    example: TrailingActivationType.IMMEDIATE,
    required: false
  })
  trailingActivation?: TrailingActivationType;

  @IsOptional()
  @IsNumber()
  @ApiProperty({
    description: 'Trailing activation value (price or percentage depending on activation type)',
    example: 5.0,
    required: false
  })
  trailingActivationValue?: number;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({
    description: 'Use OCO (one-cancels-other) for SL/TP orders',
    example: true,
    required: false
  })
  useOco?: boolean;
}

export class PlaceManualOrderDto {
  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    description: 'UUID of the exchange key to use for this order',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
  })
  exchangeKeyId: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^[A-Z0-9]+\/[A-Z0-9]+$/i, {
    message: 'Symbol must be in trading pair format (e.g., BTC/USDT)'
  })
  @ApiProperty({
    description: 'Trading pair symbol (e.g., BTC/USDT)',
    example: 'BTC/USDT'
  })
  symbol: string;

  @IsNotEmpty()
  @IsEnum(OrderType)
  @ApiProperty({
    enum: OrderType,
    description: 'Type of order to place',
    example: OrderType.MARKET
  })
  orderType: OrderType;

  @IsNotEmpty()
  @IsEnum(OrderSide)
  @ApiProperty({
    enum: OrderSide,
    description: 'Order side - buy or sell',
    example: OrderSide.BUY
  })
  side: OrderSide;

  @IsNotEmpty()
  @IsNumber()
  @Min(0.00000001)
  @ApiProperty({
    description: 'Quantity to buy/sell',
    example: 0.01,
    minimum: 0.00000001
  })
  quantity: number;

  @ValidateIf((o) => o.orderType === OrderType.LIMIT || o.orderType === OrderType.STOP_LIMIT)
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Limit price (required for LIMIT and STOP_LIMIT orders)',
    example: 50000.0,
    required: false
  })
  price?: number;

  @ValidateIf((o) => o.orderType === OrderType.STOP_LOSS || o.orderType === OrderType.STOP_LIMIT)
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Stop price (required for STOP_LOSS and STOP_LIMIT orders)',
    example: 48000.0,
    required: false
  })
  stopPrice?: number;

  @ValidateIf((o) => o.orderType === OrderType.TRAILING_STOP)
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Trailing amount (required for TRAILING_STOP orders)',
    example: 100.0,
    required: false
  })
  trailingAmount?: number;

  @ValidateIf((o) => o.orderType === OrderType.TRAILING_STOP)
  @IsNotEmpty()
  @IsEnum(TrailingType)
  @ApiProperty({
    enum: TrailingType,
    description: 'Trailing type - amount or percentage (required for TRAILING_STOP orders)',
    example: TrailingType.AMOUNT,
    required: false
  })
  trailingType?: TrailingType;

  @ValidateIf((o) => o.orderType === OrderType.TAKE_PROFIT || o.orderType === OrderType.OCO)
  @IsNotEmpty({ message: 'Take profit price is required for TAKE_PROFIT and OCO orders' })
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Take profit price (required for TAKE_PROFIT and OCO orders)',
    example: 55000.0,
    required: false
  })
  takeProfitPrice?: number;

  @ValidateIf((o) => o.orderType === OrderType.OCO)
  @IsNotEmpty({ message: 'Stop loss price is required for OCO orders' })
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Stop loss price (required for OCO orders)',
    example: 45000.0,
    required: false
  })
  stopLossPrice?: number;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    description: 'Linked order ID for OCO orders',
    example: 'b1c2d3e4-f5g6-7890-h123-i45678901234',
    required: false
  })
  ocoLinkedOrderId?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Time in force policy (GTC, IOC, FOK)',
    example: 'GTC',
    required: false
  })
  timeInForce?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ExitConfigDto)
  @ApiProperty({
    description: 'Exit configuration for automated SL/TP orders',
    type: ExitConfigDto,
    required: false
  })
  exitConfig?: ExitConfigDto;
}
