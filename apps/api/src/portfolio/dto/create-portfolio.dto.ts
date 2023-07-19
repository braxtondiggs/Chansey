import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

import { Coin } from '../../coin/coin.entity';

export class CreatePortfolioDto {
  @IsNotEmpty()
  @ApiProperty({ type: 'string' })
  coin: Coin;

  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  type: string;
}
