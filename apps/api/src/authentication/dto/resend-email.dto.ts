import { ApiProperty } from '@nestjs/swagger';

import { IsEmail, IsNotEmpty } from 'class-validator';

export class ResendEmailDto {
  @ApiProperty({
    description: 'Email address to resend verification/OTP to',
    example: 'user@example.com'
  })
  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Invalid email format' })
  email: string;
}

export class ResendEmailResponseDto {
  @ApiProperty({
    description: 'Response message',
    example: 'Verification email sent'
  })
  message: string;

  constructor(message = 'Email sent successfully') {
    this.message = message;
  }
}
