import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';

import { FailedJobSeverity, FailedJobStatus } from '../entities/failed-job-log.entity';

export class FailedJobQueryDto {
  @IsOptional()
  @IsString()
  queueName?: string;

  @IsOptional()
  @IsEnum(FailedJobStatus)
  status?: FailedJobStatus;

  @IsOptional()
  @IsEnum(FailedJobSeverity)
  severity?: FailedJobSeverity;

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
  @IsNumber()
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  offset?: number;
}
