import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, IsStrongPassword, IsStrongPasswordOptions } from 'class-validator';

import { Match } from '../../utils/match.decorator';

const passwordRequirement: IsStrongPasswordOptions = {
  minLength: 8,
  minLowercase: 1,
  minUppercase: 1,
  minNumbers: 1,
  minSymbols: 1
};

export class CreateUserDto {
  @IsEmail()
  @IsNotEmpty()
  @ApiProperty({ example: 'braxtondiggs@gmail.com', description: "User's email address" })
  email: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ example: 'Braxton ', description: "User's First Name" })
  given_name: string;

  @IsString()
  @ApiProperty({ example: 'Diggs', description: "User's Last Name" })
  family_name: string;

  @IsString()
  @IsStrongPassword(passwordRequirement)
  @ApiProperty({ example: 'Password123', description: "User's password" })
  password: string;

  @IsString()
  @Match('password')
  @ApiProperty({ example: 'Password123', description: "Confirm User's password" })
  confirm_password: string;
}
