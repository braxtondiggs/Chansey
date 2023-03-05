import { IsNotEmpty, IsNumber, IsString } from 'class-validator';
export class CreatePriceDto {
  @IsNumber()
  @IsNotEmpty()
  price: number;

  @IsString()
  coin: string;
}
