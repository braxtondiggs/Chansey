import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsBoolean, IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';

export class VerifyOtpDto {
  @ApiProperty({
    description: 'The OTP code to verify',
    example: '123456'
  })
  @IsNotEmpty()
  @IsString()
  @Length(6, 6)
  otp: string;

  @ApiProperty({
    description: 'The email associated with the OTP',
    example: 'braxtondiggs@gmail.com'
  })
  @IsNotEmpty()
  @IsString()
  email: string;

  @ApiPropertyOptional({
    description: 'Whether to extend token lifetime (remember me)',
    example: false
  })
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}

export class OtpResponseDto {
  @ApiProperty({
    description: 'Response message',
    example: 'OTP verified successfully'
  })
  message: string;

  constructor(message = 'OTP verified successfully') {
    this.message = message;
  }
}
