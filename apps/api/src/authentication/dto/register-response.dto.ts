import { ApiProperty } from '@nestjs/swagger';

import { Expose } from 'class-transformer';

import { IRegisterResponse } from '@chansey/api-interfaces';

export class RegisterResponseDto implements IRegisterResponse {
  @ApiProperty({
    description: 'Confirmation message for registration',
    example: 'User registered successfully.'
  })
  @Expose()
  message: string;

  constructor() {
    this.message = 'User registered successfully.';
  }
}
