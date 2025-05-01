import { ApiProperty } from '@nestjs/swagger';

import { Exclude } from 'class-transformer';

export class ExchangeKeyResponseDto {
  @ApiProperty({
    description: 'Unique identifier for the exchange key',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  id: string;

  @ApiProperty({
    description: 'The user ID that owns this exchange key',
    example: 'auth0|123456789'
  })
  userId: string;

  @ApiProperty({
    description: 'The exchange ID this key belongs to',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  exchangeId: string;

  @ApiProperty({
    description: 'The exchange these credentials belong to',
    example: {
      id: 'a3bb189e-8bf9-3888-9912-ace4e6543002',
      name: 'Binance',
      slug: 'binance'
    }
  })
  exchange: {
    id: string;
    name: string;
    slug: string;
  };

  @Exclude()
  apiKey: string;

  @Exclude()
  secretKey: string;

  @ApiProperty({
    description: 'Whether the API key exists',
    example: true
  })
  hasApiKey: boolean;

  @ApiProperty({
    description: 'Whether the secret key exists',
    example: true
  })
  hasSecretKey: boolean;

  @ApiProperty({
    description: 'Whether this exchange key is active',
    example: true
  })
  isActive: boolean;

  @ApiProperty({
    description: 'Optional label for this exchange key',
    example: 'My Binance Account'
  })
  label?: string;

  @ApiProperty({
    description: 'When the exchange key was created',
    example: '2023-01-01T00:00:00.000Z'
  })
  createdAt: Date;

  @ApiProperty({
    description: 'When the exchange key was last updated',
    example: '2023-01-01T00:00:00.000Z'
  })
  updatedAt: Date;
}
