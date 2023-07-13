import { IsNotEmpty, IsString, ValidateIf } from 'class-validator';

export class OrderDto {
  @IsString()
  @IsNotEmpty()
  symbol: string;

  @IsString()
  @IsNotEmpty()
  quantity: string;

  @IsString()
  @ValidateIf((o) => !o.quantity)
  price: string;
}
