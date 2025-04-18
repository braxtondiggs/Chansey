import { ApiProperty } from '@nestjs/swagger';

import { IsBoolean, IsNotEmpty, IsNumber, IsString, IsUrl } from 'class-validator';

export class CreateExchangeDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  name: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  slug: string;

  @IsString()
  @ApiProperty()
  description?: string;

  @IsString()
  @ApiProperty()
  image?: string;

  @IsString()
  @ApiProperty()
  country?: string;

  @IsNumber()
  @ApiProperty()
  yearEstablished?: number;

  @IsNumber()
  @ApiProperty()
  trustScore?: number;

  @IsNumber()
  @ApiProperty()
  trustScoreRank?: number;

  @IsNumber()
  @ApiProperty()
  tradeVolume24HBtc?: number;

  @IsNumber()
  @ApiProperty()
  tradeVolume24HNormalized?: number;

  @IsBoolean()
  @ApiProperty()
  centralized?: boolean;

  @IsUrl()
  @ApiProperty()
  url?: string;

  @IsUrl()
  @ApiProperty()
  twitter?: string;

  @IsUrl()
  @ApiProperty()
  facebook?: string;

  @IsUrl()
  @ApiProperty()
  reddit?: string;

  @IsUrl()
  @ApiProperty()
  telegram?: string;

  @IsUrl()
  @ApiProperty()
  slack?: string;

  @IsUrl()
  @ApiProperty()
  otherUrl1?: string;

  @IsUrl()
  @ApiProperty()
  otherUrl2?: string;
}
