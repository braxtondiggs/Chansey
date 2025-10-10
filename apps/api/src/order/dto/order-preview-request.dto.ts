import { ApiProperty } from '@nestjs/swagger';

import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateIf } from 'class-validator';

import { OrderSide, OrderType, TrailingType } from '../order.entity';

export class OrderPreviewRequestDto {
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
    description: 'Type of order',
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
  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Limit price (for LIMIT and STOP_LIMIT orders)',
    example: 50000.0,
    required: false
  })
  price?: number;

  @ValidateIf((o) => o.orderType === OrderType.STOP_LOSS || o.orderType === OrderType.STOP_LIMIT)
  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Stop price (for STOP_LOSS and STOP_LIMIT orders)',
    example: 48000.0,
    required: false
  })
  stopPrice?: number;

  @ValidateIf((o) => o.orderType === OrderType.TRAILING_STOP)
  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiProperty({
    description: 'Trailing amount (for TRAILING_STOP orders)',
    example: 100.0,
    required: false
  })
  trailingAmount?: number;

  @ValidateIf((o) => o.orderType === OrderType.TRAILING_STOP)
  @IsOptional()
  @IsEnum(TrailingType)
  @ApiProperty({
    enum: TrailingType,
    description: 'Trailing type - amount or percentage (for TRAILING_STOP orders)',
    example: TrailingType.AMOUNT,
    required: false
  })
  trailingType?: TrailingType;
}
