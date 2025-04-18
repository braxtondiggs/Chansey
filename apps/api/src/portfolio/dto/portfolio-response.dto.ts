import { ApiProperty } from '@nestjs/swagger';

import { CreatePortfolioDto } from './create-portfolio.dto';

import { CoinResponseDto } from '../../coin/dto/coin-response.dto';
import { UserResponseDto } from '../../users/dto';
import { PortfolioType } from '../portfolio-type.enum';

export class PortfolioResponseDto {
  @ApiProperty({
    description: 'Unique identifier for the portfolio item',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  id: string;

  @ApiProperty({
    description: 'Type of the portfolio item',
    example: PortfolioType.MANUAL,
    enum: PortfolioType
  })
  type: string;

  @ApiProperty({
    description: 'Coin associated with this portfolio item',
    type: () => CoinResponseDto
  })
  coin: CoinResponseDto;

  @ApiProperty({
    description: 'User associated with this portfolio item',
    type: () => UserResponseDto
  })
  user: UserResponseDto;

  @ApiProperty({
    description: 'Date when the portfolio item was created',
    example: '2024-04-23T18:25:43.511Z'
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Date when the portfolio item was last updated',
    example: '2024-04-24T10:15:30.123Z'
  })
  updatedAt: Date;

  constructor(portfolio: Partial<CreatePortfolioDto>) {
    Object.assign(this, portfolio);
  }
}
