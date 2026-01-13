import { ApiProperty } from '@nestjs/swagger';

import { IsEmail, IsNotEmpty } from 'class-validator';

import { IForgotPassword } from '@chansey/api-interfaces';

export class ForgotPasswordDto implements IForgotPassword {
  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Must be a valid email address' })
  @ApiProperty({
    example: 'braxtondiggs@gmail.com',
    description: "User's email address",
    required: true
  })
  email: string;

  constructor(email = '') {
    this.email = email;
  }
}
