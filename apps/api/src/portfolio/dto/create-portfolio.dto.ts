import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

import { Coin } from '../../coin/coin.entity';

export class CreatePortfolioDto {
  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({ type: 'uuid', example: '7a8a03ab-07fe-4c8a-9b5a-50fdfeb9828f', description: 'Crypto Coin Symbol' })
  coin: Coin;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ example: 'manual', description: 'Portfolio Type' })
  type: string;
}
