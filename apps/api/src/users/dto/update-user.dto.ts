import { ApiProperty, PartialType } from '@nestjs/swagger';

import { IsBoolean, IsInt, IsOptional, IsString, IsUrl, IsUUID, Max, Min } from 'class-validator';

import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @ApiProperty({ description: 'Coin risk level ID', required: false })
  @IsUUID()
  @IsOptional()
  coinRisk?: string;

  @ApiProperty({
    description: 'Independent trading style level (1-5)',
    required: false
  })
  @IsInt()
  @Min(1)
  @Max(5)
  @IsOptional()
  calculationRiskLevel?: number;

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

  @ApiProperty({ description: 'Profile picture URL', required: false })
  @IsUrl()
  @IsOptional()
  picture?: string;

  @ApiProperty({ description: 'Whether to hide user balance display', required: false })
  @IsBoolean()
  @IsOptional()
  hide_balance?: boolean;
}
