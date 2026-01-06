import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsBoolean, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class HaltTradingDto {
  @IsString()
  @MinLength(10, { message: 'Reason must be at least 10 characters for audit purposes' })
  @MaxLength(500)
  @ApiProperty({
    description: 'Reason for halting all trading',
    example: 'Market volatility spike detected - manual safety halt',
    minLength: 10,
    maxLength: 500
  })
  reason: string;

  @IsBoolean()
  @IsOptional()
  @ApiPropertyOptional({
    description: 'Also pause all active deployments',
    default: false
  })
  pauseDeployments?: boolean;

  @IsBoolean()
  @IsOptional()
  @ApiPropertyOptional({
    description: 'Also cancel all open orders on exchanges',
    default: false
  })
  cancelOpenOrders?: boolean;

  @IsObject()
  @IsOptional()
  @ApiPropertyOptional({
    description: 'Additional metadata for audit trail',
    example: { triggerSource: 'admin-dashboard', marketConditions: 'high-volatility' }
  })
  metadata?: Record<string, unknown>;
}
