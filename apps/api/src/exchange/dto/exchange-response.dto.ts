import { ApiProperty } from '@nestjs/swagger';

import { CreateExchangeDto } from './create-exchange.dto';
import { TickerResponseDto } from '../ticker/dto/ticker-response.dto';

export class ExchangeResponseDto {
  @ApiProperty({
    description: 'Unique identifier for the exchange',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  id: string;

  @ApiProperty({
    description: 'URL-friendly identifier for the exchange',
    example: 'binance'
  })
  slug: string;

  @ApiProperty({
    description: 'Name of the exchange',
    example: 'Binance'
  })
  name: string;

  @ApiProperty({
    description: 'Detailed description of the exchange',
    example: 'Binance is a global cryptocurrency exchange offering a wide range of services.',
    required: false
  })
  description?: string;

  @ApiProperty({
    description: 'URL to the exchange’s logo or image',
    example: 'https://example.com/logo.png',
    required: false
  })
  image?: string;

  @ApiProperty({
    description: 'Country where the exchange is based',
    example: 'Cayman Islands',
    required: false
  })
  country?: string;

  @ApiProperty({
    description: 'Year the exchange was established',
    example: 2017,
    required: false
  })
  yearEstablished?: number;

  @ApiProperty({
    description: 'Trust score of the exchange based on various factors',
    example: 9.5,
    required: false
  })
  trustScore?: number;

  @ApiProperty({
    description: 'Rank of the exchange based on trust score',
    example: 1,
    required: false
  })
  trustScoreRank?: number;

  @ApiProperty({
    description: '24-hour trade volume in BTC',
    example: 5000000.0
  })
  tradeVolume24HBtc?: number;

  @ApiProperty({
    description: '24-hour normalized trade volume',
    example: 7500000.0
  })
  tradeVolume24HNormalized?: number;

  @ApiProperty({
    description: 'Indicates if the exchange is centralized',
    example: true,
    required: false
  })
  centralized?: boolean;

  @ApiProperty({
    description: 'Official website URL of the exchange',
    example: 'https://www.binance.com',
    required: false
  })
  url?: string;

  @ApiProperty({
    description: 'Official Twitter handle of the exchange',
    example: '@binance',
    required: false
  })
  twitter?: string;

  @ApiProperty({
    description: 'Official Facebook page of the exchange',
    example: 'https://www.facebook.com/binance',
    required: false
  })
  facebook?: string;

  @ApiProperty({
    description: 'Official Reddit community of the exchange',
    example: 'https://www.reddit.com/r/binance',
    required: false
  })
  reddit?: string;

  @ApiProperty({
    description: 'Official Telegram group of the exchange',
    example: 'https://t.me/binance',
    required: false
  })
  telegram?: string;

  @ApiProperty({
    description: 'Official Slack channel of the exchange',
    example: 'https://binance.slack.com',
    required: false
  })
  slack?: string;

  @ApiProperty({
    description: 'Additional URL related to the exchange',
    example: 'https://www.binance.com/announcement',
    required: false
  })
  otherUrl1?: string;

  @ApiProperty({
    description: 'Another additional URL related to the exchange',
    example: 'https://www.binance.com/blog',
    required: false
  })
  otherUrl2?: string;

  @ApiProperty({
    description: 'Date when the exchange was created',
    example: '2023-01-15T10:20:30.000Z'
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Date when the exchange was last updated',
    example: '2024-04-24T10:15:30.123Z'
  })
  updatedAt: Date;

  @ApiProperty({
    description: 'List of tickers associated with the exchange',
    type: () => [TickerResponseDto],
    required: false
  })
  tickers?: TickerResponseDto[];

  constructor(exchange: Partial<CreateExchangeDto>) {
    Object.assign(this, exchange);
  }
}
