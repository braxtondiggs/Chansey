import { ApiProperty } from '@nestjs/swagger';

import { CreateTickerDto } from './create-ticker-pair.dto';
import { CoinResponseDto } from '../../dto/coin-response.dto';

export class TickerPairResponseDto {
  @ApiProperty({
    description: 'Unique identifier for the ticker',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  id: string;

  @ApiProperty({
    description: 'Trading volume',
    example: 1500000.5
  })
  volume: number;

  @ApiProperty({
    description: 'URL to the trading page',
    example: 'https://www.exchange.com/trade/BTC-USD',
    required: false
  })
  tradeUrl?: string;

  @ApiProperty({
    description: 'Percentage spread',
    example: 0.75
  })
  spreadPercentage?: number;

  @ApiProperty({
    description: 'Timestamp of the last trade',
    example: '2024-04-24T10:15:30.123Z'
  })
  lastTraded: Date;

  @ApiProperty({
    description: 'Timestamp when the ticker was fetched',
    example: '2024-04-24T10:15:30.123Z'
  })
  fetchAt: Date;

  @ApiProperty({
    description: 'Combined symbol of coin and target',
    example: 'BTCUSD'
  })
  symbol: string;

  @ApiProperty({
    description: 'Coin associated with the ticker',
    type: CoinResponseDto
  })
  coin: CoinResponseDto;

  @ApiProperty({
    description: 'Target coin associated with the ticker',
    type: CoinResponseDto
  })
  target: CoinResponseDto;

  @ApiProperty({
    description: 'Date when the ticker was created',
    example: '2023-01-15T10:20:30.000Z'
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Date when the ticker was last updated',
    example: '2024-04-24T10:15:30.123Z'
  })
  updatedAt: Date;

  constructor(ticker: Partial<CreateTickerDto>) {
    Object.assign(this, ticker);
  }
}
