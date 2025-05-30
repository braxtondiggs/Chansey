import { ApiProperty } from '@nestjs/swagger';

/**
 * Data transfer object for asset details with prices and quantities
 */
export class AssetDetailsDto {
  @ApiProperty({
    description: 'Unique identifier of the asset',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  id?: string;

  @ApiProperty({
    description: 'Symbol of the asset',
    example: 'BTC'
  })
  symbol: string;

  @ApiProperty({
    description: 'Full name of the asset',
    example: 'Bitcoin'
  })
  name: string;

  @ApiProperty({
    description: 'Current price of the asset in USD',
    example: 35000.25
  })
  price: number;

  @ApiProperty({
    description: 'Quantity of the asset owned',
    example: 0.5
  })
  quantity: number;

  @ApiProperty({
    description: 'Total value of the holding in USD',
    example: 17500.125
  })
  usdValue: number;

  @ApiProperty({
    description: 'URL to the asset image',
    example: 'https://example.com/bitcoin.png',
    required: false
  })
  image?: string;

  @ApiProperty({
    description: 'Percentage change in price over the last 24 hours',
    example: 2.5
  })
  priceChangePercentage24h: number;
}
