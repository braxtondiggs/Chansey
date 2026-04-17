import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

import type { ListingScoreBreakdown } from '../entities/listing-candidate.entity';

export class ListingCandidateDto {
  @ApiProperty() id: string;
  @ApiProperty() coinId: string;
  @ApiProperty() score: number;
  @ApiPropertyOptional({ nullable: true }) scoreBreakdown?: ListingScoreBreakdown | null;
  @ApiProperty() qualified: boolean;
  @ApiProperty() firstScoredAt: Date;
  @ApiProperty() lastScoredAt: Date;
  @ApiPropertyOptional({ nullable: true }) lastTradedAt?: Date | null;
}

export class ListingCandidateQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @ApiPropertyOptional()
  qualified?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  @ApiPropertyOptional({ minimum: 1, maximum: 500, default: 100 })
  limit?: number;
}
