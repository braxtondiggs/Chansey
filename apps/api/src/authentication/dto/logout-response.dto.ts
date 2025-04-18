import { ApiProperty } from '@nestjs/swagger';

import { Expose } from 'class-transformer';

import { ILogoutResponse } from '@chansey/api-interfaces';

export class LogoutResponseDto implements ILogoutResponse {
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
