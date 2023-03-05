import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

import { Coin } from '../../coin/coin.entity';

export class CreatePriceDto {
  @IsNumber()
  @IsNotEmpty()
  price: number;

  @IsString()
  @IsNotEmpty()
  coin: Coin;
}
