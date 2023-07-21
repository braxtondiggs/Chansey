import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsString } from 'class-validator';

import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @ApiProperty({ example: '1234567890', description: 'Binance API Key' })
  @IsString()
  binance: string;

  @ApiProperty({ example: '0987654321', description: 'Binance API Secret Key' })
  @IsString()
  binanceSecret: string;
}
