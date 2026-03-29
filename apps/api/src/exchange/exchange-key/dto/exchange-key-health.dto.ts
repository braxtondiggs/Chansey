import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import type { ExchangeKeyErrorCategory, ExchangeKeyHealthStatus } from '@chansey/api-interfaces';

export class HealthHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class ExchangeKeyHealthSummaryDto {
  @ApiProperty({ description: 'Exchange key ID' })
  id: string;

  @ApiProperty({ description: 'Exchange ID' })
  exchangeId: string;

  @ApiProperty({ description: 'Exchange name and slug' })
  exchange: { id: string; name: string; slug: string };

  @ApiProperty({ description: 'Current health status', example: 'healthy' })
  healthStatus: ExchangeKeyHealthStatus;

  @ApiPropertyOptional({ description: 'Last health check timestamp' })
  lastHealthCheckAt: Date | null;

  @ApiProperty({ description: 'Number of consecutive failures', example: 0 })
  consecutiveFailures: number;

  @ApiPropertyOptional({ description: 'Last error category', example: 'authentication' })
  lastErrorCategory: ExchangeKeyErrorCategory | null;

  @ApiPropertyOptional({ description: 'Last error message' })
  lastErrorMessage: string | null;

  @ApiProperty({ description: 'Whether this key was auto-deactivated', example: false })
  deactivatedByHealthCheck: boolean;

  @ApiProperty({ description: 'Whether the key is active', example: true })
  isActive: boolean;
}

export class ExchangeKeyHealthLogDto {
  @ApiProperty({ description: 'Log entry ID' })
  id: string;

  @ApiProperty({ description: 'Health check status', example: 'healthy' })
  status: ExchangeKeyHealthStatus;

  @ApiPropertyOptional({ description: 'Error category' })
  errorCategory: ExchangeKeyErrorCategory | null;

  @ApiPropertyOptional({ description: 'Error message' })
  errorMessage: string | null;

  @ApiPropertyOptional({ description: 'Response time in milliseconds', example: 250 })
  responseTimeMs: number | null;

  @ApiProperty({ description: 'When the check was performed' })
  checkedAt: Date;
}

export class ExchangeKeyHealthHistoryResponseDto {
  @ApiProperty({ description: 'Health log entries', type: [ExchangeKeyHealthLogDto] })
  data: ExchangeKeyHealthLogDto[];

  @ApiProperty({ description: 'Total number of entries', example: 100 })
  total: number;

  @ApiProperty({ description: 'Current page', example: 1 })
  page: number;

  @ApiProperty({ description: 'Entries per page', example: 20 })
  limit: number;
}
