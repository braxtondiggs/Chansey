import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

import { UserDto } from './auth-response.dto';

export class LoginResponseDto {
  @ApiProperty({
    description: 'Message indicating the login status',
    example: 'Logged in successfully'
  })
  @Expose()
  message: string;

  @ApiProperty({
    description: 'JWT access token',
    example: 'eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9...'
  })
  @Expose()
  access_token: string;

  @ApiProperty({
    description: 'Token expiration time in seconds',
    example: 14400
  })
  @Expose()
  expires_in: number;

  @ApiProperty({
    description: 'JWT refresh token',
    example: null,
    nullable: true
  })
  @Expose()
  refresh_token: string | null;

  @ApiProperty({
    description: 'JWT ID token',
    example: 'eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9...'
  })
  @Expose()
  id_token: string;

  @ApiProperty({
    description: 'Flag to indicate if email OTP screen should be shown',
    example: null,
    nullable: true
  })
  @Expose()
  should_show_email_otp_screen: boolean | null;

  @ApiProperty({
    description: 'Flag to indicate if mobile OTP screen should be shown',
    example: null,
    nullable: true
  })
  @Expose()
  should_show_mobile_otp_screen: boolean | null;

  @ApiProperty({
    description: 'Flag to indicate if TOTP screen should be shown',
    example: null,
    nullable: true
  })
  @Expose()
  should_show_totp_screen: boolean | null;

  @ApiProperty({
    description: 'Authenticator scanner image',
    example: null,
    nullable: true
  })
  @Expose()
  authenticator_scanner_image: string | null;

  @ApiProperty({
    description: 'Authenticator secret',
    example: null,
    nullable: true
  })
  @Expose()
  authenticator_secret: string | null;

  @ApiProperty({
    description: 'Authenticator recovery codes',
    example: ['code1', 'code2', 'code3'],
    isArray: true,
    type: String
  })
  @Expose()
  authenticator_recovery_codes: string[] | null = [];

  @ApiProperty({
    description: 'User information',
    type: () => UserDto
  })
  @Expose()
  user: UserDto;

  constructor(partial: Partial<LoginResponseDto>) {
    Object.assign(this, partial);
  }
}
