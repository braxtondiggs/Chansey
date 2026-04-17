import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

import { ListingPositionStatus, ListingStrategyType } from '../entities/listing-trade-position.entity';

export class ListingTradePositionDto {
  @ApiProperty() id: string;
  @ApiProperty() userId: string;
  @ApiProperty() orderId: string;
  @ApiProperty() coinId: string;
  @ApiProperty({ enum: ListingStrategyType }) strategyType: ListingStrategyType;
  @ApiProperty({ enum: ListingPositionStatus }) status: ListingPositionStatus;
  @ApiPropertyOptional({ nullable: true }) announcementId?: string | null;
  @ApiPropertyOptional({ nullable: true }) candidateId?: string | null;
  @ApiPropertyOptional({ nullable: true }) hedgeOrderId?: string | null;
  @ApiProperty() expiresAt: Date;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class ListingTradePositionQueryDto {
  @IsOptional()
  @IsEnum(ListingPositionStatus)
  @ApiPropertyOptional({ enum: ListingPositionStatus })
  status?: ListingPositionStatus;

  @IsOptional()
  @IsEnum(ListingStrategyType)
  @ApiPropertyOptional({ enum: ListingStrategyType })
  strategyType?: ListingStrategyType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  @ApiPropertyOptional({ minimum: 1, maximum: 500, default: 100 })
  limit?: number;
}
