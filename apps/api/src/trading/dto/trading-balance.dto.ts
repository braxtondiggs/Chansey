import { ApiProperty } from '@nestjs/swagger';

export class TradingBalanceDto {
  @ApiProperty({
    description: 'Coin information',
    example: {
      id: 'bitcoin',
      name: 'Bitcoin',
      symbol: 'BTC',
      slug: 'bitcoin'
    }
  })
  coin: {
    id: string;
    name: string;
    symbol: string;
    slug: string;
  };

  @ApiProperty({
    description: 'Available balance for trading',
    example: 0.12345
  })
  available: number;

  @ApiProperty({
    description: 'Locked balance (in orders, etc)',
    example: 0.01234
  })
  locked: number;

  @ApiProperty({
    description: 'Total balance (available + locked)',
    example: 0.13579
  })
  total: number;
}
