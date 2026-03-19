import { ApiProperty } from '@nestjs/swagger';

import { CoinResponseDto } from '../../coin/dto/coin-response.dto';
import { UserResponseDto } from '../../users/dto';
import { CoinSelectionType } from '../coin-selection-type.enum';

export class CoinSelectionResponseDto {
  @ApiProperty({
    description: 'Unique identifier for the coin selection item',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  id: string;

  @ApiProperty({
    description: 'Type of the coin selection item',
    example: CoinSelectionType.MANUAL,
    enum: CoinSelectionType
  })
  type: CoinSelectionType;

  @ApiProperty({
    description: 'Coin associated with this selection item',
    type: () => CoinResponseDto
  })
  coin: CoinResponseDto;

  @ApiProperty({
    description: 'User associated with this selection item',
    type: () => UserResponseDto
  })
  user: UserResponseDto;

  @ApiProperty({
    description: 'Date when the coin selection item was created',
    example: '2024-04-23T18:25:43.511Z'
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Date when the coin selection item was last updated',
    example: '2024-04-24T10:15:30.123Z'
  })
  updatedAt: Date;

  constructor(partial: Partial<CoinSelectionResponseDto>) {
    Object.assign(this, partial);
  }
}
