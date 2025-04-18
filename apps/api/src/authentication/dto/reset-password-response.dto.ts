import { ApiProperty } from '@nestjs/swagger';

import { Expose } from 'class-transformer';

import { IResetPasswordResponse } from '@chansey/api-interfaces';

export class ResetPasswordResponseDto implements IResetPasswordResponse {
  @ApiProperty({
    description: 'Confirmation message for password reset',
    example: 'Password has been reset successfully.'
  })
  @Expose()
  message: string;

  constructor(message = 'Password has been reset successfully.') {
    this.message = message;
  }
}
