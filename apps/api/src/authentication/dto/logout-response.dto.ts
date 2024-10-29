import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class LogoutResponseDto {
  @ApiProperty({
    description: 'Confirmation message for logout',
    example: 'Logout successful.'
  })
  @Expose()
  message: string;

  constructor(message: string) {
    this.message = message;
  }
}
