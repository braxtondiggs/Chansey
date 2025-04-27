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

  @ApiProperty({ example: 'Braxton', description: 'User first name', required: false })
  @IsString()
  @IsOptional()
  given_name?: string;

  @ApiProperty({ example: 'Diggs', description: 'User last name', required: false })
  @IsString()
  @IsOptional()
  family_name?: string;

  @ApiProperty({ example: 'S.', description: 'User middle name', required: false })
  @IsString()
  @IsOptional()
  middle_name?: string;

  @ApiProperty({ example: 'Big Daddy', description: 'User nickname', required: false })
  @IsString()
  @IsOptional()
  nickname?: string;

  @ApiProperty({ example: '1990-01-01', description: 'User birthdate', required: false })
  @IsString()
  @IsOptional()
  birthdate?: string;

  @ApiProperty({ example: 'male', description: 'User gender', required: false })
  @IsString()
  @IsOptional()
  gender?: string;

  @ApiProperty({ example: '+14155552671', description: 'User phone number', required: false })
  @IsString()
  @IsOptional()
  phone_number?: string;

  @ApiProperty({ description: 'Base64 encoded profile picture or URL', required: false })
  @IsString()
  @IsOptional()
  picture?: string;

  @ApiProperty({ description: "User's old password", required: false })
  @IsString()
  @IsOptional()
  old_password?: string;

  @ApiProperty({ description: "User's new password", required: false })
  @IsString()
  @IsOptional()
  new_password?: string;

  @ApiProperty({ description: "User's new password confirmation", required: false })
  @IsString()
  @IsOptional()
  confirm_new_password?: string;
}
