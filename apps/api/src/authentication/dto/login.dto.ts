import { ApiProperty } from '@nestjs/swagger';

export class LogInDto {
  @ApiProperty({ example: 'braxtondiggs@gmail.com', description: "User's email address" })
  email: string;
  @ApiProperty({ example: 'Blackbad882003', description: "User's password" })
  password: string;
}
