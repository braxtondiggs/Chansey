import { ApiProperty } from '@nestjs/swagger';

import { IsEmail } from 'class-validator';

import { IForgotPassword } from '@chansey/api-interfaces';

export class ForgotPasswordDto implements IForgotPassword {
  @ApiProperty({
    example: 'braxtondiggs@gmail.com',
    description: "User's email address",
    required: true
  })
  @IsEmail()
  email: string;

  constructor(email = '') {
    this.email = email;
  }
}
