import { ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsOptional, ValidateNested } from 'class-validator';

import { AlgorithmConfig } from '../algorithm.entity';

export class ActivateAlgorithmDto {
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
