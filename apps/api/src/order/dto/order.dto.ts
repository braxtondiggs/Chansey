import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, ValidateIf } from 'class-validator';

export class OrderDto {
  @IsUUID()
  @IsNotEmpty()
  @ApiProperty({ example: '7a8a03ab-07fe-4c8a-9b5a-50fdfeb9828f' }) // NOTE: This is the UUID of the coin BTC
  coinId: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ example: '0.001' })
  quantity: string;

  @IsString()
  @ValidateIf((o) => !o.quantity)
  price: string;
}
