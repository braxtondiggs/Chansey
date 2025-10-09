import { ApiProperty } from '@nestjs/swagger';

import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf
} from 'class-validator';

import { OrderSide, OrderType, TrailingType } from '../order.entity';

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
  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Take profit price (optional for TAKE_PROFIT, required for OCO orders)',
    example: 55000.0,
    required: false
  })
  takeProfitPrice?: number;

  @ValidateIf((o) => o.orderType === OrderType.OCO)
  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Stop loss price (optional for OCO orders)',
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
}
