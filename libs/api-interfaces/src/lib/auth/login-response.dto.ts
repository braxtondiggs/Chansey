import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

import { IUser, UserDto } from './auth-response.dto';

export interface ILoginResponse {
  message: string;
  access_token: string;
  expires_in: number;
  refresh_token: string | null;
  id_token: string;
  should_show_email_otp_screen: boolean | null;
  should_show_mobile_otp_screen: boolean | null;
  should_show_totp_screen: boolean | null;
  authenticator_scanner_image: string | null;
  authenticator_secret: string | null;
  authenticator_recovery_codes: string[] | null;
  user: IUser;
}

export class LoginResponseDto implements ILoginResponse {
  @ApiProperty({
    description: 'Message indicating the login status',
    example: 'Logged in successfully'
  })
  @Expose()
  message = 'Logged in successfully';

  @ApiProperty({
    description: 'JWT access token',
    example: 'eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9...'
  })
  @Expose()
  access_token = '';

  @ApiProperty({
    description: 'Token expiration time in seconds',
    example: 14400
  })
  @Expose()
  expires_in = 0;

  @ApiProperty({
    description: 'JWT refresh token',
    example: null,
    nullable: true
  })
  @Expose()
  refresh_token: string | null = null;

  @ApiProperty({
    description: 'JWT ID token',
    example: 'eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9...'
  })
  @Expose()
  id_token = '';

  @ApiProperty({
    description: 'Flag to indicate if email OTP screen should be shown',
    example: null,
    nullable: true
  })
  @Expose()
  should_show_email_otp_screen: boolean | null = null;

  @ApiProperty({
    description: 'Flag to indicate if mobile OTP screen should be shown',
    example: null,
    nullable: true
  })
  @Expose()
  should_show_mobile_otp_screen: boolean | null = null;

  @ApiProperty({
    description: 'Flag to indicate if TOTP screen should be shown',
    example: null,
    nullable: true
  })
  @Expose()
  should_show_totp_screen: boolean | null = null;

  @ApiProperty({
    description: 'Authenticator scanner image',
    example: null,
    nullable: true
  })
  @Expose()
  authenticator_scanner_image: string | null = null;

  @ApiProperty({
    description: 'Authenticator secret',
    example: null,
    nullable: true
  })
  @Expose()
  authenticator_secret: string | null = null;

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
  user: UserDto = new UserDto({});

  constructor(partial: Partial<LoginResponseDto>) {
    Object.assign(this, partial);
  }
}
