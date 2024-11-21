import { Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsNumber, IsPositive, IsUUID } from 'class-validator';

import { Coin } from '../../coin/coin.entity';

export class CreatePriceDto {
  @IsNumber()
  @IsNotEmpty()
  @IsPositive()
  @Type(() => Number)
  price: number;

  @IsNumber()
  @IsNotEmpty()
  @IsPositive()
  @Type(() => Number)
  marketCap: number;

  @IsNumber()
  @IsNotEmpty()
  @IsPositive()
  @Type(() => Number)
  totalVolume: number;

  @IsDate()
  @IsNotEmpty()
  @Type(() => Date)
  geckoLastUpdatedAt: Date;

  @IsNotEmpty()
  coin: Coin;

  @IsUUID()
  @IsNotEmpty()
  coinId: string;
}
