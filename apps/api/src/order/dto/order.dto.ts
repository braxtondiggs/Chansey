import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, ValidateIf } from 'class-validator';

export class OrderDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  symbol: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  quantity: string;

  @IsString()
  @ValidateIf((o) => !o.quantity)
  price: string;
}
