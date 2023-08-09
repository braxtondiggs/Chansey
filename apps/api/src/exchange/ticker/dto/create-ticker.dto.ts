import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsNumber, IsString, IsUrl } from 'class-validator';

import { Coin } from '../../../coin/coin.entity';
import { Exchange } from '../../exchange.entity';

export class CreateTickerDto {
  @IsNumber()
  @IsNotEmpty()
  @ApiProperty()
  volume: number;

  @IsNumber()
  @ApiProperty()
  spreadPercentage?: number;

  @IsDateString()
  @ApiProperty()
  lastTraded: Date;

  @IsDateString()
  @ApiProperty()
  fetchAt: Date;

  @IsUrl()
  @ApiProperty()
  tradeUrl?: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ type: 'string' })
  exchange: Exchange;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ type: 'string' })
  coin: Coin;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ type: 'string' })
  target: Coin;
}
