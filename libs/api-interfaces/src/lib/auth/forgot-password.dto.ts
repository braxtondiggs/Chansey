import { ApiProperty } from '@nestjs/swagger';

import { IsEmail } from 'class-validator';

export interface IForgotPassword {
  email: string;
}

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
