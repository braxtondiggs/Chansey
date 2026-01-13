import { ApiProperty } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Matches } from 'class-validator';

export class TickerDto {
  @IsNotEmpty()
  @IsString()
  @Matches(/^[A-Z0-9]{1,10}\/[A-Z0-9]{1,10}$/, { message: 'symbol must be a valid trading pair (e.g., BTC/USDT)' })
  @ApiProperty({
    description: 'Trading pair symbol',
    example: 'BTC/USDT'
  })
  symbol: string;

  @IsNumber()
  @IsPositive({ message: 'Price must be a positive number' })
  @ApiProperty({
    description: 'Current price',
    example: 45000.5
  })
  price: number;

  @IsOptional()
  @IsNumber()
  @ApiProperty({
    description: 'Price change in the last 24h',
    example: 1200.3,
    required: false
  })
  priceChange?: number;

  @IsOptional()
  @IsNumber()
  @ApiProperty({
    description: 'Price change percentage in the last 24h',
    example: 2.75,
    required: false
  })
  priceChangePercent?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  @ApiProperty({
    description: 'Highest price in the last 24h',
    example: 46000.0,
    required: false
  })
  high24h?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  @ApiProperty({
    description: 'Lowest price in the last 24h',
    example: 43500.0,
    required: false
  })
  low24h?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  @ApiProperty({
    description: 'Trading volume in base currency in the last 24h',
    example: 1250.75,
    required: false
  })
  volume24h?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  @ApiProperty({
    description: 'Trading volume in quote currency in the last 24h',
    example: 56287500.5,
    required: false
  })
  quoteVolume24h?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  @ApiProperty({
    description: 'Opening price 24h ago',
    example: 43800.2,
    required: false
  })
  openPrice?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  @ApiProperty({
    description: 'Previous closing price',
    example: 43800.2,
    required: false
  })
  prevClosePrice?: number;

  @IsDate()
  @Type(() => Date)
  @ApiProperty({
    description: 'Last updated timestamp',
    example: '2024-01-15T10:20:30.000Z'
  })
  lastUpdated: Date;
}
