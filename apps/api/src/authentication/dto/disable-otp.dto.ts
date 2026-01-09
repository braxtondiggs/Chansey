import { ApiProperty } from '@nestjs/swagger';

import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class DisableOtpDto {
  @ApiProperty({
    description: 'Current password to confirm OTP disable',
    example: 'CurrentPassword123!'
  })
  @IsNotEmpty({ message: 'Password is required to disable 2FA' })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password: string;
}

export class EnableOtpResponseDto {
  @ApiProperty({
    description: 'Response message',
    example: 'OTP enabled successfully'
  })
  message: string;

  constructor(message = 'OTP enabled successfully') {
    this.message = message;
  }
}

export class DisableOtpResponseDto {
  @ApiProperty({
    description: 'Response message',
    example: 'OTP disabled successfully'
  })
  message: string;

  constructor(message = 'OTP disabled successfully') {
    this.message = message;
  }
}
