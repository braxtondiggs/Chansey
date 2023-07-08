import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Coin } from './coin.entity';
import { CoinService } from './coin.service';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';
import FindOneParams from '../utils/findOneParams';

@ApiTags('Coin')
@ApiBearerAuth('token')
@Controller('coin')
export class CoinController {
  constructor(private readonly coin: CoinService) {}

  @Get()
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({})
  async getCoins(): Promise<Coin[]> {
    return this.coin.getCoins();
  }

  @Get(':id')
  @UseGuards(JwtAuthenticationGuard)
  getCoinById(@Param() { id }: FindOneParams): Promise<Coin> {
    return this.coin.getCoinById(id);
  }
}
