import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsString, ValidateNested } from 'class-validator';

export class FillDto {
  @ApiProperty({
    description: 'Price at which the asset was filled',
    example: '86051.51000000'
  })
  @IsString()
  price: string;

  @ApiProperty({
    description: 'Quantity of the asset that was filled',
    example: '0.00002000'
  })
  @IsString()
  qty: string;

  @ApiProperty({
    description: 'Commission charged for the fill',
    example: '0.01032618'
  })
  @IsString()
  commission: string;

  @ApiProperty({
    description: 'Asset in which the commission was charged',
    example: 'USDT'
  })
  @IsString()
  commissionAsset: string;

  @ApiProperty({
    description: 'Unique identifier for the trade',
    example: 29802357
  })
  @IsNumber()
  tradeId: number;
}
export class OrderBinanceResponseDto {
  @ApiProperty({
    description: 'Symbol of the trading pair',
    example: 'BTCUSDT'
  })
  @IsString()
  symbol: string;

  @ApiProperty({
    description: 'Unique identifier for the order',
    example: 1366356939
  })
  @IsNumber()
  orderId: number;

  @ApiProperty({
    description: 'Order list identifier',
    example: -1
  })
  @IsNumber()
  orderListId: number;

  @ApiProperty({
    description: 'Unique client order identifier',
    example: '6oz9UpPPW76Lo7XaADgOti'
  })
  @IsString()
  clientOrderId: string;

  @ApiProperty({
    description: 'Transaction timestamp in milliseconds',
    example: 1731355212696,
    type: Number
  })
  @IsNumber()
  transactTime: number; // Consider transforming to Date if necessary

  @ApiProperty({
    description: 'Price at which the order was placed',
    example: '0.00000000'
  })
  @IsString()
  price: string;

  @ApiProperty({
    description: 'Original quantity of the order',
    example: '0.00002000'
  })
  @IsString()
  origQty: string;

  @ApiProperty({
    description: 'Quantity of the order that has been executed',
    example: '0.00002000'
  })
  @IsString()
  executedQty: string;

  @ApiProperty({
    description: 'Cumulative quote asset transacted',
    example: '1.72103020'
  })
  @IsString()
  cummulativeQuoteQty: string;

  @ApiProperty({
    description: 'Status of the order',
    example: 'FILLED'
  })
  @IsString()
  status: string;

  @ApiProperty({
    description: 'Time in force policy',
    example: 'GTC'
  })
  @IsString()
  timeInForce: string;

  @ApiProperty({
    description: 'Type of the order',
    example: 'MARKET'
  })
  @IsString()
  type: string;

  @ApiProperty({
    description: 'Side of the order',
    example: 'SELL'
  })
  @IsString()
  side: string;

  @ApiProperty({
    description: 'Timestamp when the order was placed',
    example: 1731355212696,
    type: Number
  })
  @IsNumber()
  workingTime: number; // Consider transforming to Date if necessary

  @ApiProperty({
    description: 'List of fills associated with the order',
    type: [FillDto]
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FillDto)
  fills: FillDto[];

  @ApiProperty({
    description: 'Mode of self-trade prevention',
    example: 'EXPIRE_MAKER'
  })
  @IsString()
  selfTradePreventionMode: string;
}
