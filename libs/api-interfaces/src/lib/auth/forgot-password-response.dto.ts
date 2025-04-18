import { ApiProperty } from '@nestjs/swagger';

import { Expose } from 'class-transformer';

export interface IForgotPasswordResponse {
  message: string;
  should_show_mobile_otp_screen: boolean | null;
}

export class ForgotPasswordResponseDto implements IForgotPasswordResponse {
  @ApiProperty({
    description: 'Response message',
    example: 'Password reset instructions have been sent to your email'
  })
  @Expose()
  message = 'Password reset instructions have been sent to your email';

  @ApiProperty({
    description: 'Indicates if the mobile OTP screen should be shown',
    example: true
  })
  @Expose()
  should_show_mobile_otp_screen = null;

  constructor(partial: Partial<ForgotPasswordResponseDto> = {}) {
    Object.assign(this, partial);
  }
}
