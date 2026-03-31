import { ApiProperty } from '@nestjs/swagger';

import { IsEnum, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

import { CoinSelectionSource } from '../coin-selection-source.enum';
import { CoinSelectionType } from '../coin-selection-type.enum';

export class CreateCoinSelectionDto {
  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    type: 'string',
    format: 'uuid',
    example: '7a8a03ab-07fe-4c8a-9b5a-50fdfeb9828f',
    description: 'The unique identifier of the coin to add to coin selection'
  })
  coinId: string;

  @IsEnum(CoinSelectionType)
  @IsNotEmpty()
  @ApiProperty({
    enum: CoinSelectionType,
    example: CoinSelectionType.MANUAL,
    description: 'The type of coin selection'
  })
  type: CoinSelectionType;

  @IsOptional()
  @IsEnum(CoinSelectionSource)
  @ApiProperty({
    enum: CoinSelectionSource,
    example: CoinSelectionSource.RISK_BASED,
    description: 'The source that created this automatic selection',
    required: false
  })
  source?: CoinSelectionSource;
}
