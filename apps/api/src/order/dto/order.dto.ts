import { ApiProperty } from '@nestjs/swagger';

import { IsEnum, IsNotEmpty, IsUUID, IsNumberString, IsOptional, ValidateIf } from 'class-validator';

import { MinStringNumber } from '../../utils/decorators/min-string-number.decorator';
import { OrderType, OrderSide } from '../order.entity';

export class OrderDto {
  @IsNotEmpty()
  @IsEnum(OrderSide)
  @ApiProperty({
    enum: OrderSide,
    example: OrderSide.BUY,
    description: 'Order side - BUY or SELL'
  })
  side: OrderSide;

  @IsNotEmpty()
  @IsEnum(OrderType)
  @ApiProperty({
    enum: OrderType,
    example: OrderType.MARKET,
    description: 'Order type - MARKET for immediate execution, LIMIT for specific price'
  })
  type: OrderType;

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    example: '7a8a03ab-07fe-4c8a-9b5a-50fdfeb9828f',
    description: 'UUID of the coin to buy/sell'
  })
  coinId: string;

  @IsOptional()
  @IsUUID()
  @ApiProperty({
    example: '1e8a03ab-07fe-4c8a-9b5a-50fdfeb9828f',
    description: 'UUID of the quote coin (defaults to USDT if not provided)',
    required: false
  })
  quoteCoinId?: string;

  @IsNotEmpty()
  @IsNumberString()
  @MinStringNumber(0.00001)
  @ApiProperty({
    example: '0.1',
    description: 'Quantity to buy/sell (minimum: 0.00001)'
  })
  quantity: string;

  @ValidateIf((o) => o.type === OrderType.LIMIT || o.type === OrderType.LIMIT_MAKER)
  @IsNotEmpty()
  @IsNumberString()
  @ApiProperty({
    example: '50000.00',
    description: 'Price per unit (required for LIMIT orders)',
    required: false
  })
  price?: string;
}
