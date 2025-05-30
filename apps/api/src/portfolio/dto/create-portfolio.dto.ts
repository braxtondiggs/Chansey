import { ApiProperty } from '@nestjs/swagger';

import { IsEnum, IsNotEmpty, IsUUID } from 'class-validator';

import { PortfolioType } from '../portfolio-type.enum';

export class CreatePortfolioDto {
  @IsNotEmpty()
  @IsUUID()
  @ApiProperty({
    type: 'string',
    format: 'uuid',
    example: '7a8a03ab-07fe-4c8a-9b5a-50fdfeb9828f',
    description: 'The unique identifier of the coin to add to portfolio'
  })
  coinId: string;

  @IsEnum(PortfolioType)
  @IsNotEmpty()
  @ApiProperty({
    enum: PortfolioType,
    example: PortfolioType.MANUAL,
    description: 'The type of portfolio management'
  })
  type: PortfolioType;
}
