import { ApiPropertyOptional } from '@nestjs/swagger';

import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class ResumeTradingDto {
  @IsString()
  @IsOptional()
  @MaxLength(500)
  @ApiPropertyOptional({
    description: 'Notes about why trading is being resumed',
    example: 'Market conditions stabilized, volatility returned to normal levels',
    maxLength: 500
  })
  reason?: string;

  @IsObject()
  @IsOptional()
  @ApiPropertyOptional({
    description: 'Additional metadata for audit trail'
  })
  metadata?: Record<string, unknown>;
}
