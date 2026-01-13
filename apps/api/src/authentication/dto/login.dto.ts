import { ApiProperty } from '@nestjs/swagger';

import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

import { ILogin } from '@chansey/api-interfaces';

export class LogInDto implements ILogin {
  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Must be a valid email address' })
  @ApiProperty({ example: 'braxtondiggs@gmail.com', description: "User's email address", required: true })
  email: string;

  @IsNotEmpty({ message: 'Password is required' })
  @IsString()
  @ApiProperty({ example: 'Blackbad882003', description: "User's password", required: true })
  password: string;

  @IsOptional()
  @IsBoolean({ message: 'Remember must be a boolean value' })
  @ApiProperty({ example: false, description: "Remember user's login", required: false })
  remember?: boolean;

  constructor(email = '', password = '', remember = false) {
    this.email = email;
    this.password = password;
    this.remember = remember;
  }
}
