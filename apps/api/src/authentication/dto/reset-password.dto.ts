import { ApiProperty } from '@nestjs/swagger';

import { IsNotEmpty, IsString } from 'class-validator';

import { IResetPassword } from '@chansey/api-interfaces';

export class ResetPasswordDto implements IResetPassword {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9...',
    description: 'Password reset token',
    required: true
  })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({
    example: 'NewSecurePassword123!',
    description: 'New password',
    required: false
  })
  @IsString()
  password?: string;

  @ApiProperty({
    example: 'NewSecurePassword123!',
    description: 'Confirm new password',
    required: false
  })
  @IsString()
  confirm_password?: string;

  constructor(token = '', password = '', confirm_password = '') {
    this.token = token;
    this.password = password;
    this.confirm_password = confirm_password;
  }
}
