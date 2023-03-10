import { IsNotEmpty, IsString } from 'class-validator';

import { Coin } from '../../coin/coin.entity';
import User from '../../users/users.entity';

export class CreatePortfolioDto {
  @IsNotEmpty()
  coin: Coin;

  @IsString()
  @IsNotEmpty()
  type: string;

  /*@IsNotEmpty()
  user: User;*/
}
