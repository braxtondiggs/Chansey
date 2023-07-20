import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsNotEmpty, IsNumber, IsString } from 'class-validator';

import { Coin } from '../../../coin/coin.entity';
import { Exchange } from '../../exchange.entity';

export class CreateTickerDto {
  @IsNumber()
  @IsNotEmpty()
  @ApiProperty()
  volume: number;

  @IsBoolean()
  @ApiProperty()
  stale?: boolean;

  @IsBoolean()
  @ApiProperty()
  anomaly?: boolean;

  @IsDateString()
  @ApiProperty()
  lastTraded: Date;

  @IsDateString()
  @ApiProperty()
  fetchAt: Date;

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
