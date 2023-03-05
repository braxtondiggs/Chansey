import { IsNotEmpty, IsString } from 'class-validator';

import { Coin } from '../../coin/coin.entity';

export class CreatePortfolioDto {
  @IsString()
  @IsNotEmpty()
  coin: Coin;
}
