import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { ListingAnnouncementType } from '../entities/listing-announcement.entity';

export class ListingAnnouncementDto {
  @ApiProperty() id: string;
  @ApiProperty() exchangeSlug: string;
  @ApiPropertyOptional({ nullable: true }) coinId?: string | null;
  @ApiProperty() announcedSymbol: string;
  @ApiProperty({ enum: ListingAnnouncementType }) announcementType: ListingAnnouncementType;
  @ApiProperty() sourceUrl: string;
  @ApiProperty() detectedAt: Date;
  @ApiProperty() dispatched: boolean;
  @ApiProperty() createdAt: Date;
}

export class ListingAnnouncementQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  @ApiPropertyOptional({ minimum: 1, maximum: 500, default: 100 })
  limit?: number;

  @IsOptional()
  @IsDateString()
  @ApiPropertyOptional()
  since?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @ApiPropertyOptional()
  exchangeSlug?: string;
}
