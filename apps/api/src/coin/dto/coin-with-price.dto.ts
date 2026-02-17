import { ApiProperty } from '@nestjs/swagger';

export class CoinWithPriceDto {
  @ApiProperty({
    description: 'Unique identifier for the coin',
    example: '7a8a03ab-07fe-4c8a-9b5a-50fdfeb9828f'
  })
  id: string;

  @ApiProperty({
    description: 'Unique slug identifier for the coin',
    example: 'bitcoin'
  })
  slug: string;

  @ApiProperty({
    description: 'Name of the coin',
    example: 'Bitcoin'
  })
  name: string;

  @ApiProperty({
    description: 'Symbol of the coin',
    example: 'BTC'
  })
  symbol: string;

  @ApiProperty({
    description: "URL to the coin's image",
    example: 'https://example.com/images/bitcoin.png',
    required: false
  })
  image?: string | null;

  @ApiProperty({
    description: 'Current price of the coin in USD',
    example: 45000.12345678,
    required: false,
    type: Number
  })
  currentPrice?: number | null;
}
