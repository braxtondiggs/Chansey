import { ApiProperty } from '@nestjs/swagger';

import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, IsUrl } from 'class-validator';

export class CreateExchangeDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  name: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false })
  slug?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false })
  description?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false })
  image?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ required: false })
  country?: string;

  @IsOptional()
  @IsNumber()
  @ApiProperty({ required: false })
  yearEstablished?: number;

  @IsOptional()
  @IsNumber()
  @ApiProperty({ required: false })
  trustScore?: number;

  @IsOptional()
  @IsNumber()
  @ApiProperty({ required: false })
  trustScoreRank?: number;

  @IsOptional()
  @IsNumber()
  @ApiProperty({ required: false })
  tradeVolume24HBtc?: number;

  @IsOptional()
  @IsNumber()
  @ApiProperty({ required: false })
  tradeVolume24HNormalized?: number;

  @IsOptional()
  @IsBoolean()
  @ApiProperty({ required: false })
  centralized?: boolean;

  @IsUrl()
  @ApiProperty()
  url: string;

  @IsOptional()
  @IsUrl()
  @ApiProperty({ required: false })
  twitter?: string;

  @IsOptional()
  @IsUrl()
  @ApiProperty({ required: false })
  facebook?: string;

  @IsOptional()
  @IsUrl()
  @ApiProperty({ required: false })
  reddit?: string;

  @IsOptional()
  @IsUrl()
  @ApiProperty({ required: false })
  telegram?: string;

  @IsOptional()
  @IsUrl()
  @ApiProperty({ required: false })
  slack?: string;

  @IsOptional()
  @IsUrl()
  @ApiProperty({ required: false })
  otherUrl1?: string;

  @IsOptional()
  @IsUrl()
  @ApiProperty({ required: false })
  otherUrl2?: string;

  @IsBoolean()
  @ApiProperty()
  supported: boolean;
}
