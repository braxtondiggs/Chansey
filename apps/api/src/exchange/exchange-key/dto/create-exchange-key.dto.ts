import { ApiProperty } from '@nestjs/swagger';

import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateExchangeKeyDto {
  @ApiProperty({
    description: 'The exchange ID this key belongs to',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  @IsUUID()
  @IsNotEmpty()
  exchangeId: string;

  @ApiProperty({
    description: 'The API key for the exchange',
    example: 'your-api-key-here'
  })
  @IsString()
  @IsNotEmpty()
  apiKey: string;

  @ApiProperty({
    description: 'The secret key for the exchange',
    example: 'your-secret-key-here'
  })
  @IsString()
  @IsNotEmpty()
  secretKey: string;

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
    default: true,
    required: false
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
