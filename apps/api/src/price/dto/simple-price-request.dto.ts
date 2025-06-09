import { ApiProperty } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class SimplePriceRequestDto {
  @ApiProperty({
    description: 'Comma-separated list of coin IDs (slugs) to get prices for',
    example: 'bitcoin,ethereum,chainlink',
    required: true
  })
  @IsString()
  @MaxLength(2000) // Reasonable limit for URL query parameter
  @Transform(({ value }) => value?.toLowerCase())
  ids: string;

  @ApiProperty({
    description: 'Target currency for prices',
    example: 'usd',
    default: 'usd',
    required: false
  })
  @IsString()
  @IsOptional()
  @Transform(({ value }) => value?.toLowerCase())
  vs_currencies?: string = 'usd';

  @ApiProperty({
    description: 'Include 24hr volume in response',
    example: false,
    default: false,
    required: false
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => [true, 'true', 1, '1'].indexOf(value) > -1)
  include_24hr_vol?: boolean = false;

  @ApiProperty({
    description: 'Include market cap in response',
    example: false,
    default: false,
    required: false
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => [true, 'true', 1, '1'].indexOf(value) > -1)
  include_market_cap?: boolean = false;

  @ApiProperty({
    description: 'Include 24hr change in response',
    example: false,
    default: false,
    required: false
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => [true, 'true', 1, '1'].indexOf(value) > -1)
  include_24hr_change?: boolean = false;

  @ApiProperty({
    description: 'Include last updated timestamp in response',
    example: false,
    default: false,
    required: false
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => [true, 'true', 1, '1'].indexOf(value) > -1)
  include_last_updated_at?: boolean = false;

  // Transform the comma-separated string into an array for validation
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((id) => id.trim().toLowerCase())
        .filter((id) => id);
    }
    return value;
  })
  get coinIds(): string[] {
    return this.ids
      .split(',')
      .map((id) => id.trim().toLowerCase())
      .filter((id) => id);
  }
}
