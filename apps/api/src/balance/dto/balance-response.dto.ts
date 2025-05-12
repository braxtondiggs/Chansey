import { ApiProperty } from '@nestjs/swagger';

export class AssetBalanceDto {
  @ApiProperty({
    description: 'Asset symbol',
    example: 'BTC'
  })
  asset: string;

  @ApiProperty({
    description: 'The available amount of the asset',
    example: '0.12345'
  })
  free: string;

  @ApiProperty({
    description: 'Amount of the asset that is locked (in orders, etc)',
    example: '0.01234'
  })
  locked: string;

  @ApiProperty({
    description: 'The current USD value of the asset',
    example: 6543.21
  })
  usdValue?: number;
}

export class ExchangeBalanceDto {
  @ApiProperty({
    description: 'Unique identifier for the exchange',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  id: string;

  @ApiProperty({
    description: 'Exchange identifier',
    example: 'binance'
  })
  slug: string;

  @ApiProperty({
    description: 'Exchange display name',
    example: 'Binance'
  })
  name: string;

  @ApiProperty({
    description: 'List of balances for each asset',
    type: [AssetBalanceDto]
  })
  balances: AssetBalanceDto[];

  @ApiProperty({
    description: 'Total USD value of all assets in the exchange',
    example: 10234.56
  })
  totalUsdValue: number;

  @ApiProperty({
    description: 'Timestamp of when this balance data was collected',
    example: '2025-05-09T12:34:56.789Z'
  })
  timestamp: Date;
}

export class HistoricalBalanceDto extends ExchangeBalanceDto {
  @ApiProperty({
    description: 'Time period this historical balance represents',
    example: '24h',
    enum: ['24h', '7d', '30d']
  })
  period: string;
}

export class BalanceResponseDto {
  @ApiProperty({
    description: 'Current balances across all exchanges',
    type: [ExchangeBalanceDto]
  })
  current: ExchangeBalanceDto[];

  @ApiProperty({
    description: 'Historical balances (if requested)',
    type: [HistoricalBalanceDto],
    required: false
  })
  historical?: HistoricalBalanceDto[];

  @ApiProperty({
    description: 'Total USD value across all exchanges',
    example: 25678.9
  })
  totalUsdValue: number;
}
