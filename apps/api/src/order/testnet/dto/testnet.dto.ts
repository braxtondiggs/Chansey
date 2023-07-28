import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

import { OrderDto } from '../../dto/order.dto';

export class TestnetDto extends PartialType(OrderDto) {
  @IsUUID()
  @ApiProperty({ example: '100c1721-7b0b-4d96-a18e-40904c0cc36b' })
  algorithm: string;
}
