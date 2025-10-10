import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsOptional, IsUUID, ValidateNested } from 'class-validator';

import { AlgorithmConfig } from '../algorithm.entity';

export class ActivateAlgorithmDto {
  @IsUUID()
  @ApiProperty({
    description: 'Exchange key ID to use for trading',
    example: 'd6ee401g-1eh2-6111-2235-dfh7h9876335',
    required: true
  })
  exchangeKeyId: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => Object)
  @ApiPropertyOptional({
    description: 'User-specific algorithm configuration overrides',
    example: {
      parameters: {
        period: 20,
        multiplier: 2.0
      },
      settings: {
        timeout: 30000,
        retries: 3
      }
    }
  })
  config?: AlgorithmConfig;
}
