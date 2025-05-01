import { ApiProperty } from '@nestjs/swagger';

import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateExchangeKeyDto {
  @ApiProperty({
    description: 'The API key for the exchange',
    example: 'your-api-key-here',
    required: false
  })
  @IsString()
  @IsOptional()
  apiKey?: string;

  @ApiProperty({
    description: 'The secret key for the exchange',
    example: 'your-secret-key-here',
    required: false
  })
  @IsString()
  @IsOptional()
  secretKey?: string;

  @ApiProperty({
    description: 'Optional label for this exchange key',
    example: 'My Binance Account',
    required: false
  })
  @IsString()
  @IsOptional()
  label?: string;

  @ApiProperty({
    description: 'Whether this exchange key is active',
    example: true,
    required: false
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
