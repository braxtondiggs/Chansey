import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/**
 * DTO for validating coinId path parameter
 */
export class CoinIdParamDto {
  @ApiProperty({
    description: 'Coin UUID',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  @IsUUID('4')
  coinId: string;
}

/**
 * DTO for validating candle query parameters
 */
export class GetCandlesQueryDto {
  @ApiProperty({
    description: 'Start date (ISO 8601 format)',
    example: '2024-01-01T00:00:00.000Z'
  })
  @IsDateString()
  start: string;

  @ApiProperty({
    description: 'End date (ISO 8601 format)',
    example: '2024-01-31T23:59:59.999Z'
  })
  @IsDateString()
  end: string;
}

/**
 * DTO for validating backfill hot coins query parameters
 */
export class BackfillHotCoinsQueryDto {
  @ApiPropertyOptional({
    description: 'Number of coins to backfill (default: 150, max: 500)',
    example: 150,
    minimum: 1,
    maximum: 500
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  @Type(() => Number)
  limit?: number;
}
