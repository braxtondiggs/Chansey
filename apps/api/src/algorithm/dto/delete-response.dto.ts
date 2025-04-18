import { ApiProperty } from '@nestjs/swagger';

import { Expose } from 'class-transformer';

export class DeleteResponseDto {
  @ApiProperty({
    description: 'Confirmation message for deletion',
    example: 'Algorithm deleted successfully.'
  })
  @Expose()
  message: string;

  constructor(message: string) {
    this.message = message;
  }
}
