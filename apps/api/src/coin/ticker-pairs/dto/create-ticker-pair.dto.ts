import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsEnum, IsNotEmpty, IsNumber, IsUrl } from 'class-validator';

import { Exchange } from '../../../exchange/exchange.entity';
import { Coin } from '../../coin.entity';
import { TickerPairStatus } from '../ticker-pairs.entity';

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

  @IsNotEmpty()
  @ApiProperty({ type: () => Exchange })
  exchange: Exchange;

  @IsNotEmpty()
  @ApiProperty({ type: () => Coin })
  baseAsset: Coin;

  @IsNotEmpty()
  @ApiProperty({ type: () => Coin })
  quoteAsset: Coin;

  @IsEnum(TickerPairStatus)
  @IsNotEmpty()
  @ApiProperty({
    enum: TickerPairStatus,
    default: TickerPairStatus.TRADING
  })
  status: TickerPairStatus;

  @IsBoolean()
  @ApiProperty({ default: true })
  isSpotTradingAllowed: boolean;

  @IsBoolean()
  @ApiProperty({ default: false })
  isMarginTradingAllowed: boolean;
}
