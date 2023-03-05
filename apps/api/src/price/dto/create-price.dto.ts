import { IsNotEmpty, IsNumber } from 'class-validator';

import { Coin } from '../../coin/coin.entity';

export class CreatePriceDto {
  @IsNumber()
  @IsNotEmpty()
  price: number;

  @IsNotEmpty()
  coin: Coin;
}
