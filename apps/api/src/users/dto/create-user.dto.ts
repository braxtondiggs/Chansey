import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  @IsNotEmpty()
  @ApiProperty({ example: 'braxtondiggs@gmail.com', description: "User's email address" })
  email: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ example: 'Braxton Diggs', description: "User's name" })
  name: string;

  @IsString()
  @ApiProperty({ example: 'Password123', description: "User's password" })
  password: string;
}
