import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegimeGateOverrideDto {
  @IsBoolean()
  @ApiProperty({
    description: 'Force-allow all signals regardless of regime',
    example: true
  })
  forceAllow: boolean;

  @IsString()
  @MinLength(10, { message: 'Reason must be at least 10 characters for audit purposes' })
  @MaxLength(500)
  @ApiProperty({
    description: 'Reason for enabling the override',
    example: 'Short-term opportunity during bear regime — manual review completed',
    minLength: 10,
    maxLength: 500
  })
  reason: string;
}

export class DisableRegimeGateOverrideDto {
  @IsString()
  @IsOptional()
  @MaxLength(500)
  @ApiPropertyOptional({
    description: 'Reason for disabling the override',
    example: 'Market conditions normalized',
    maxLength: 500
  })
  reason?: string;
}
