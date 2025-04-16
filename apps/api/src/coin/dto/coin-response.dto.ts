import { ApiProperty } from '@nestjs/swagger';

import { OrderResponseDto } from '../../order/dto';
import { PortfolioResponseDto } from '../../portfolio/dto/portfolio-response.dto';
import { CreatePriceDto } from '../../price/dto/create-price.dto';
import { CreateCoinDto } from './create-coin.dto';

export class CoinResponseDto {
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
    description: 'Description of the coin',
    example: 'Bitcoin is a decentralized digital currency...',
    required: false
  })
  description?: string;

  @ApiProperty({
    description: "URL to the coin's image",
    example: 'https://example.com/images/bitcoin.png',
    required: false
  })
  image?: string;

  @ApiProperty({
    description: 'Genesis date of the coin',
    example: '2009-01-03',
    required: false
  })
  genesis?: Date;

  @ApiProperty({
    description: 'Market rank of the coin',
    example: 1,
    required: false
  })
  marketRank?: number;

  @ApiProperty({
    description: 'Total supply of the coin',
    example: 21000000.0,
    required: false,
    type: Number
  })
  totalSupply?: number;

  @ApiProperty({
    description: 'Total volume of the coin',
    example: 1260000000000.0,
    required: false,
    type: Number
  })
  totalVolume?: number;

  @ApiProperty({
    description: 'Circulating supply of the coin',
    example: 18500000.0,
    required: false,
    type: Number
  })
  circulatingSupply?: number;

  @ApiProperty({
    description: 'Maximum supply of the coin',
    example: 21000000.0,
    required: false,
    type: Number
  })
  maxSupply?: number;

  @ApiProperty({
    description: 'Coingecko rank of the coin',
    example: 1,
    required: false
  })
  geckoRank?: number;

  @ApiProperty({
    description: 'Developer score of the coin',
    example: 75.5,
    required: false,
    type: Number
  })
  developerScore?: number;

  @ApiProperty({
    description: 'Community score of the coin',
    example: 80.0,
    required: false,
    type: Number
  })
  communityScore?: number;

  @ApiProperty({
    description: 'Liquidity score of the coin',
    example: 70.0,
    required: false,
    type: Number
  })
  liquidityScore?: number;

  @ApiProperty({
    description: 'Public interest score of the coin',
    example: 85.0,
    required: false,
    type: Number
  })
  publicInterestScore?: number;

  @ApiProperty({
    description: 'Sentiment up score',
    example: 60.0,
    required: false,
    type: Number
  })
  sentimentUp?: number;

  @ApiProperty({
    description: 'Sentiment down score',
    example: 40.0,
    required: false,
    type: Number
  })
  sentimentDown?: number;

  @ApiProperty({
    description: 'All-time high price of the coin',
    example: 60000.0,
    required: false,
    type: Number
  })
  ath?: number;

  @ApiProperty({
    description: 'Change from all-time high',
    example: -20.0,
    required: false,
    type: Number
  })
  athChange?: number;

  @ApiProperty({
    description: 'Date when ATH was reached',
    example: '2021-04-14T00:00:00Z',
    required: false,
    type: Date
  })
  athDate?: Date;

  @ApiProperty({
    description: 'All-time low price of the coin',
    example: 3000.0,
    required: false,
    type: Number
  })
  atl?: number;

  @ApiProperty({
    description: 'Change from all-time low',
    example: 50.0,
    required: false,
    type: Number
  })
  atlChange?: number;

  @ApiProperty({
    description: 'Date when ATL was reached',
    example: '2013-12-18T00:00:00Z',
    required: false,
    type: Date
  })
  atlDate?: Date;

  @ApiProperty({
    description: 'Date when Coingecko last updated the coin information',
    example: '2023-09-15T12:34:56Z',
    required: false,
    type: Date
  })
  geckoLastUpdatedAt?: Date;

  @ApiProperty({
    description: 'Timestamp when the coin was created',
    example: '2022-01-01T00:00:00Z',
    readOnly: true
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Timestamp when the coin was last updated',
    example: '2023-01-01T00:00:00Z',
    readOnly: true
  })
  updatedAt: Date;

  @ApiProperty({
    description: 'List of orders for the coin',
    type: () => OrderResponseDto,
    isArray: true,
    required: false
  })
  orders: OrderResponseDto[];

  @ApiProperty({
    description: 'List of portfolios associated with the coin',
    type: () => PortfolioResponseDto,
    isArray: true,
    required: false
  })
  portfolios: PortfolioResponseDto[];

  @ApiProperty({
    description: 'List of prices for the coin',
    type: () => CreatePriceDto,
    isArray: true,
    required: false
  })
  prices: CreatePriceDto[];

  constructor(coin: Partial<CreateCoinDto>) {
    Object.assign(this, coin);
  }
}
