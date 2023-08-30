import { IsDate, IsNotEmpty, IsNumber } from 'class-validator';

import { Coin } from '../../coin/coin.entity';

export class CreatePriceDto {
  @IsNumber()
  @IsNotEmpty()
  price: number;

  @IsNumber()
  @IsNotEmpty()
  marketCap: number;

  @IsNumber()
  @IsNotEmpty()
  totalVolume: number;

  @IsDate()
  @IsNotEmpty()
  geckoLastUpdatedAt: Date;

  @IsNotEmpty()
  coin: Coin;
}
