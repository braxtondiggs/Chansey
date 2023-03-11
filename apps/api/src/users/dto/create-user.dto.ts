import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength, Validate } from 'class-validator';
import { PasswordValidation, PasswordValidationRequirement } from 'class-validator-password-check';

import { Match } from '../../utils/match.decorator';

const passwordRequirement: PasswordValidationRequirement = {
  mustContainLowerLetter: true,
  mustContainNumber: true,
  mustContainSpecialCharacter: true,
  mustContainUpperLetter: true
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
  @MinLength(6)
  @Validate(PasswordValidation, [passwordRequirement])
  @ApiProperty({ example: 'Password123', description: "User's password" })
  password: string;

  @IsString()
  @Match('password')
  @ApiProperty({ example: 'Password123', description: "Confirm User's password" })
  confirm_password: string;
}
