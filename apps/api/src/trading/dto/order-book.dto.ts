import { ApiProperty } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsArray, IsDate, IsNumber, IsPositive, ValidateNested } from 'class-validator';

export class OrderBookEntryDto {
  @IsNumber()
  @IsPositive({ message: 'Price must be a positive number' })
  @ApiProperty({
    description: 'Price level',
    example: 45000.5
  })
  price: number;

  @IsNumber()
  @IsPositive({ message: 'Quantity must be a positive number' })
  @ApiProperty({
    description: 'Quantity at this price level',
    example: 0.12345
  })
  quantity: number;

  @IsNumber()
  @IsPositive({ message: 'Total must be a positive number' })
  @ApiProperty({
    description: 'Total value (price * quantity)',
    example: 5555.62
  })
  total: number;
}

export class OrderBookDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderBookEntryDto)
  @ApiProperty({
    description: 'Buy orders (bids)',
    type: [OrderBookEntryDto]
  })
  bids: OrderBookEntryDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderBookEntryDto)
  @ApiProperty({
    description: 'Sell orders (asks)',
    type: [OrderBookEntryDto]
  })
  asks: OrderBookEntryDto[];

  @IsDate()
  @Type(() => Date)
  @ApiProperty({
    description: 'Last updated timestamp',
    example: '2024-01-15T10:20:30.000Z'
  })
  lastUpdated: Date;
}
