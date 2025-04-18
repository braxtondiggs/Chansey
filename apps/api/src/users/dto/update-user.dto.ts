import { ApiProperty, PartialType } from '@nestjs/swagger';

import { IsOptional, IsString, IsUUID } from 'class-validator';

import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @ApiProperty({ example: '1234567890', description: 'Binance API Key', required: false })
  @IsString()
  @IsOptional()
  binance?: string;

  @ApiProperty({ example: '0987654321', description: 'Binance API Secret Key', required: false })
  @IsString()
  @IsOptional()
  binanceSecret?: string;

  @ApiProperty({ description: 'Risk level ID', required: false })
  @IsUUID()
  @IsOptional()
  risk?: string;
}
