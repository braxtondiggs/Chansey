import { Type } from 'class-transformer';
import { IsOptional, IsString, IsNumber, IsEnum, IsDateString, IsArray } from 'class-validator';

/**
 * AuditTrailQuery DTO
 *
 * Flexible query parameters for filtering audit logs
 */
export class AuditTrailQuery {
  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsString()
  eventType?: string | string[];

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  offset?: number;
}
