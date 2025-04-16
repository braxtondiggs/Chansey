import { ApiProperty } from '@nestjs/swagger';

export interface ILogin {
  email: string;
  password: string;
}

export class LogInDto implements ILogin {
  @ApiProperty({ example: 'braxtondiggs@gmail.com', description: "User's email address", required: true })
  email: string;
  @ApiProperty({ example: 'Blackbad882003', description: "User's password", required: true })
  password: string;

  constructor(email = '', password = '') {
    this.email = email;
    this.password = password;
  }
}

