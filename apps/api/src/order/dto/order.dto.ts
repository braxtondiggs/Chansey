import { IsNotEmpty, IsString } from 'class-validator';

export class OrderDto {
  @IsString()
  @IsNotEmpty()
  symbol: string;

  @IsString()
  @IsNotEmpty()
  quantity: string;
}
