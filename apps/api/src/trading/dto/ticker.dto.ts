import { ApiProperty } from '@nestjs/swagger';

export class TickerDto {
  @ApiProperty({
    description: 'Trading pair symbol',
    example: 'BTC/USDT'
  })
  symbol: string;

  @ApiProperty({
    description: 'Current price',
    example: 45000.5
  })
  price: number;

  @ApiProperty({
    description: 'Price change in the last 24h',
    example: 1200.3,
    required: false
  })
  priceChange?: number;

  @ApiProperty({
    description: 'Price change percentage in the last 24h',
    example: 2.75,
    required: false
  })
  priceChangePercent?: number;

  @ApiProperty({
    description: 'Highest price in the last 24h',
    example: 46000.0,
    required: false
  })
  high24h?: number;

  @ApiProperty({
    description: 'Lowest price in the last 24h',
    example: 43500.0,
    required: false
  })
  low24h?: number;

  @ApiProperty({
    description: 'Trading volume in base currency in the last 24h',
    example: 1250.75,
    required: false
  })
  volume24h?: number;

  @ApiProperty({
    description: 'Trading volume in quote currency in the last 24h',
    example: 56287500.5,
    required: false
  })
  quoteVolume24h?: number;

  @ApiProperty({
    description: 'Opening price 24h ago',
    example: 43800.2,
    required: false
  })
  openPrice?: number;

  @ApiProperty({
    description: 'Previous closing price',
    example: 43800.2,
    required: false
  })
  prevClosePrice?: number;

  @ApiProperty({
    description: 'Last updated timestamp',
    example: '2024-01-15T10:20:30.000Z'
  })
  lastUpdated: Date;
}
