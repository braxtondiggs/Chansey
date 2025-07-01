import { ApiProperty } from '@nestjs/swagger';

export class OrderBookEntryDto {
  @ApiProperty({
    description: 'Price level',
    example: 45000.5
  })
  price: number;

  @ApiProperty({
    description: 'Quantity at this price level',
    example: 0.12345
  })
  quantity: number;

  @ApiProperty({
    description: 'Total value (price * quantity)',
    example: 5555.62
  })
  total: number;
}

export class OrderBookDto {
  @ApiProperty({
    description: 'Buy orders (bids)',
    type: [OrderBookEntryDto]
  })
  bids: OrderBookEntryDto[];

  @ApiProperty({
    description: 'Sell orders (asks)',
    type: [OrderBookEntryDto]
  })
  asks: OrderBookEntryDto[];

  @ApiProperty({
    description: 'Last updated timestamp',
    example: '2024-01-15T10:20:30.000Z'
  })
  lastUpdated: Date;
}
