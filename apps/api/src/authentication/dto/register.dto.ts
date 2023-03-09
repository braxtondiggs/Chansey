import { ApiProperty } from '@nestjs/swagger';
export class RegisterDto {
  @ApiProperty({ example: 'braxtondiggs@gmail.com', description: "User's email address" })
  email: string;
  @ApiProperty({ example: 'Braxton Diggs', description: "User's name" })
  name: string;
  @ApiProperty({ example: 'Password123', description: "User's password" })
  password: string;
}
