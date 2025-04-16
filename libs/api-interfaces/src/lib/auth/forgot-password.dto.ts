import { ApiProperty } from '@nestjs/swagger';

export interface IForgotPassword {
  email: string;
}

export class ForgotPasswordDto implements IForgotPassword {
  @ApiProperty({ example: 'braxtondiggs@gmail.com', description: "User's email address", required: true })
  email: string;

  constructor(email = '') {
    this.email = email;
  }
}
