import { ApiProperty } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsObject, IsString, Matches, Min, ValidateNested } from 'class-validator';

export class CoinInfoDto {
  @IsNotEmpty()
  @IsString()
  id: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^[A-Z0-9]{2,10}$/, { message: 'symbol must be a valid coin symbol (e.g., BTC, ETH, USDT)' })
  symbol: string;

  @IsNotEmpty()
  @IsString()
  slug: string;
}

export class TradingBalanceDto {
  @IsNotEmpty()
  @IsObject()
  @ValidateNested()
  @Type(() => CoinInfoDto)
  @ApiProperty({
    description: 'Coin information',
    example: {
      id: 'bitcoin',
      name: 'Bitcoin',
      symbol: 'BTC',
      slug: 'bitcoin'
    }
  })
  coin: CoinInfoDto;

  @IsNumber()
  @Min(0, { message: 'Available balance cannot be negative' })
  @ApiProperty({
    description: 'Available balance for trading',
    example: 0.12345
  })
  available: number;

  @IsNumber()
  @Min(0, { message: 'Locked balance cannot be negative' })
  @ApiProperty({
    description: 'Locked balance (in orders, etc)',
    example: 0.01234
  })
  locked: number;

  @IsNumber()
  @Min(0, { message: 'Total balance cannot be negative' })
  @ApiProperty({
    description: 'Total balance (available + locked)',
    example: 0.13579
  })
  total: number;
}
