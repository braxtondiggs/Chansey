import { ApiProperty } from '@nestjs/swagger';

export class LogInDto {
  @ApiProperty({ example: 'braxtondiggs@gmail.com', description: "User's email address", required: true })
  email: string;
  @ApiProperty({ example: 'Blackbad882003', description: "User's password", required: true })
  password: string;
}
