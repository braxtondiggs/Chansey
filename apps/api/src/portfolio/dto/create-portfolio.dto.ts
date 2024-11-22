import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString, IsUUID } from 'class-validator';

import { Coin } from '../../coin/coin.entity';
import { User } from '../../users/users.entity';
import { PortfolioType } from '../portfolio-type.enum';

export class CreatePortfolioDto {
  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    type: 'string',
    format: 'uuid',
    example: '7a8a03ab-07fe-4c8a-9b5a-50fdfeb9828f',
    description: 'The unique identifier of the coin'
  })
  coin: Coin;

  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    type: 'string',
    format: 'uuid',
    description: 'The user who owns this portfolio'
  })
  user: User;

  @IsString()
  @IsNotEmpty()
  @IsEnum(PortfolioType)
  @ApiProperty({
    enum: PortfolioType,
    example: PortfolioType.MANUAL,
    description: 'The type of portfolio management'
  })
  type: PortfolioType;
}
