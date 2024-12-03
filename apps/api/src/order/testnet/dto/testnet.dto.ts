import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

import { OrderDto } from '../../dto/order.dto';

export class TestnetDto extends OrderDto {
  @IsNotEmpty()
  @IsUUID('4')
  @ApiProperty({
    description: 'UUID of the algorithm to use for this test order',
    example: '100c1721-7b0b-4d96-a18e-40904c0cc36b',
    required: true
  })
  algorithm: string;
}
