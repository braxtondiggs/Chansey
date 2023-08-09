import { Controller, Get, HttpStatus, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Coin, CoinRelations } from './coin.entity';
import { CoinService } from './coin.service';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';
import FindOneParams from '../utils/findOneParams';

@ApiTags('Coin')
@ApiBearerAuth('token')
@ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Invalid credentials' })
@Controller('coin')
export class CoinController {
  constructor(private readonly coin: CoinService) {}

  @Get()
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({ summary: 'Get all coins', description: 'This endpoint is used to get all coins.' })
  @ApiResponse({ status: HttpStatus.OK, description: 'The coins records', type: Coin, isArray: true })
  async getCoins(): Promise<Coin[]> {
    return this.coin.getCoins();
  }

  @Get(':id')
  @UseGuards(JwtAuthenticationGuard)
  @ApiParam({ name: 'id', required: true, description: 'The id of the coin', type: String })
  @ApiOperation({ summary: 'Get coin by id', description: 'This endpoint is used to get a coin by id.' })
  @ApiResponse({ status: HttpStatus.OK, description: 'The coin record', type: Coin, isArray: false })
  getCoinById(@Param() { id }: FindOneParams): Promise<Coin> {
    return this.coin.getCoinById(id, [CoinRelations.TICKERS]);
  }

  @Get('symbol/:symbol')
  @UseGuards(JwtAuthenticationGuard)
  @ApiParam({ name: 'symbol', required: true, description: 'The symbol of the coin', type: String })
  @ApiOperation({ summary: 'Get coin by symbol', description: 'This endpoint is used to get a coin by symbol.' })
  @ApiResponse({ status: HttpStatus.OK, description: 'The coin record', type: Coin, isArray: false })
  getCoinBySymbol(@Param() { symbol }): Promise<Coin> {
    return this.coin.getCoinBySymbol(symbol, [CoinRelations.TICKERS]);
  }

  @Get(':id/historical')
  @UseGuards(JwtAuthenticationGuard)
  @ApiParam({ name: 'id', required: true, description: 'The id of the coin', type: String })
  @ApiOperation({
    summary: 'Get historical data for coin',
    description: 'This endpoint is used to get historical data for a coin.'
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'The coin record', type: Coin, isArray: false })
  getCoinHistoricalData(@Param() { id }: FindOneParams): Promise<any> {
    return this.coin.getCoinHistoricalData(id);
  }
}
