import { ApiProperty } from '@nestjs/swagger';

import { IsNotEmpty, IsString, Length } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({
    description: 'Email verification token from the verification email',
    example: 'a1b2c3d4e5f6...'
  })
  @IsNotEmpty({ message: 'Verification token is required' })
  @IsString()
  @Length(64, 64, { message: 'Invalid verification token format' })
  token: string;
}

export class VerifyEmailResponseDto {
  @ApiProperty({
    description: 'Response message',
    example: 'Email verified successfully'
  })
  message: string;

  constructor(message = 'Email verified successfully') {
    this.message = message;
  }
}
