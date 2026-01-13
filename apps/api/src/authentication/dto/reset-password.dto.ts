import { ApiProperty } from '@nestjs/swagger';

import { IsNotEmpty, IsString, IsStrongPassword } from 'class-validator';

import { IResetPassword } from '@chansey/api-interfaces';

import { Match } from '../../utils/decorators/match.decorator';

export class ResetPasswordDto implements IResetPassword {
  @IsNotEmpty({ message: 'Reset token is required' })
  @IsString()
  @ApiProperty({
    example: 'eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9...',
    description: 'Password reset token',
    required: true
  })
  token: string;

  @IsNotEmpty({ message: 'Password is required' })
  @IsString()
  @IsStrongPassword(
    { minLength: 8, minUppercase: 1, minLowercase: 1, minNumbers: 1, minSymbols: 0 },
    {
      message: 'Password must contain at least 8 characters, one uppercase letter, one lowercase letter, and one number'
    }
  )
  @ApiProperty({
    example: 'NewSecurePassword123!',
    description: 'New password',
    required: true
  })
  password: string;

  @IsNotEmpty({ message: 'Password confirmation is required' })
  @IsString()
  @Match('password', { message: 'Passwords do not match' })
  @ApiProperty({
    example: 'NewSecurePassword123!',
    description: 'Confirm new password',
    required: true
  })
  confirm_password: string;

  constructor(token = '', password = '', confirm_password = '') {
    this.token = token;
    this.password = password;
    this.confirm_password = confirm_password;
  }
}
