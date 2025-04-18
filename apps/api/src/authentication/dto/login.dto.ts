import { ApiProperty } from '@nestjs/swagger';

import { ILogin } from '@chansey/api-interfaces';

export class LogInDto implements ILogin {
  @ApiProperty({ example: 'braxtondiggs@gmail.com', description: "User's email address", required: true })
  email: string;

  @ApiProperty({ example: 'Blackbad882003', description: "User's password", required: true })
  password: string;

  @ApiProperty({ example: false, description: "Remember user's login", required: false })
  remember?: boolean;

  constructor(email = '', password = '', remember = false) {
    this.email = email;
    this.password = password;
    this.remember = remember;
  }
}
