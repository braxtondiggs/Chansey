import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO representing a user's supported exchange key with exchange details.
 * Used when checking which exchanges a user has active keys for.
 */
export class SupportedExchangeKeyDto {
  @ApiProperty({
    description: 'Unique identifier for the exchange key',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  id: string;

  @ApiProperty({
    description: 'The exchange ID this key belongs to',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  exchangeId: string;

  @ApiProperty({
    description: 'Whether this exchange key is active and validated',
    example: true
  })
  isActive: boolean;

  @ApiProperty({
    description: 'The name of the exchange',
    example: 'Binance US'
  })
  name: string;

  @ApiProperty({
    description: 'The slug identifier for the exchange',
    example: 'binance_us'
  })
  slug: string;

  @ApiPropertyOptional({
    description: 'Whether this exchange supports futures trading'
  })
  supportsFutures?: boolean;

  @ApiPropertyOptional({
    description: 'When the exchange key was first created',
    example: '2026-03-12T00:00:00.000Z'
  })
  createdAt?: Date;
}
