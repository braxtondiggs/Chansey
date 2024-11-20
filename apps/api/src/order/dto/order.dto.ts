import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumberString, ValidateIf } from 'class-validator';

import { MinStringNumber } from '../../utils/decorators/min-string-number.decorator';
import { OrderType } from '../order.entity';

export class OrderDto {
  @IsNotEmpty()
  @ApiProperty({ example: '7a8a03ab-07fe-4c8a-9b5a-50fdfeb9828f' }) // NOTE: This is the UUID of the coin BTC
  coinId: string;

  @MinStringNumber(0.00001)
  @ApiProperty({
    example: '0.0001',
    description: 'Minimum quantity is 0.00001'
  })
  quantity: string;

  @IsNumberString()
  @ValidateIf((o) => o.type === OrderType.LIMIT || o.type === OrderType.LIMIT_MAKER)
  @ApiProperty({
    example: '30000.00',
    required: false,
    description: 'Required for LIMIT orders'
  })
  price: string;
}
