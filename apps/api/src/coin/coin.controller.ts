import { Controller, Get, HttpStatus, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Coin, CoinRelations } from './coin.entity';
import { CoinService } from './coin.service';
import { CoinResponseDto, CoinWithPriceDto } from './dto';

import GetUser from '../authentication/decorator/get-user.decorator';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';
import { User } from '../users/users.entity';

@ApiTags('Coin')
@ApiBearerAuth('token')
@UseGuards(JwtAuthenticationGuard)
@ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Invalid credentials' })
@Controller('coin')
export class CoinController {
  constructor(private readonly coin: CoinService) {}

  @Get()
  @ApiOperation({ summary: 'Get all coins', description: 'Retrieve a list of all coins.' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of coins retrieved successfully.',
    type: [Coin]
  })
  async getCoins(): Promise<Coin[]> {
    return this.coin.getCoins();
  }

  @Get('with-prices')
  @ApiOperation({
    summary: 'Get all coins with current prices',
    description:
      'Retrieve a lightweight list of all coins with their current prices. Optimized for frequent updates with 300+ coins.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of coins with current prices retrieved successfully.',
    type: [CoinWithPriceDto]
  })
  async getCoinsWithCurrentPrices(): Promise<CoinWithPriceDto[]> {
    return this.coin.getCoinsWithCurrentPrices();
  }

  @Get(':id')
  @ApiParam({
    name: 'id',
    required: true,
    description: 'The UUID of the coin',
    type: String,
    example: '7a8a03ab-07fe-4c8a-9b5a-50fdfeb9828f'
  })
  @ApiOperation({ summary: 'Get coin by ID', description: 'Retrieve a specific coin by its UUID.' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Coin retrieved successfully.',
    type: CoinResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Coin not found.'
  })
  getCoinById(@Param('id', new ParseUUIDPipe()) id: string): Promise<Coin> {
    return this.coin.getCoinById(id, [CoinRelations.BASE_ASSETS]);
  }

  @Get('symbol/:symbol')
  @ApiParam({
    name: 'symbol',
    required: true,
    description: 'The symbol of the coin',
    type: String,
    example: 'BTC'
  })
  @ApiOperation({ summary: 'Get coin by symbol', description: 'Retrieve a specific coin by its symbol.' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Coin retrieved successfully.',
    type: CoinResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Coin not found.'
  })
  getCoinBySymbol(@Param() { symbol }): Promise<Coin> {
    return this.coin.getCoinBySymbol(symbol, [CoinRelations.BASE_ASSETS]);
  }

  @Get('symbols/:symbols')
  @ApiParam({
    name: 'symbols',
    required: true,
    description: 'Comma-separated list of coin symbols',
    type: String,
    example: 'BTC,ETH,LTC'
  })
  @ApiOperation({ summary: 'Get multiple coins by symbols', description: 'Retrieve multiple coins by their symbols.' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Coins retrieved successfully.',
    type: [CoinResponseDto]
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'One or more coins not found.'
  })
  getMultipleCoinsBySymbols(@Param('symbols') symbolsParam: string): Promise<Coin[]> {
    const symbols = symbolsParam.split(',').filter(Boolean);
    return this.coin.getMultipleCoinsBySymbol(symbols, [CoinRelations.BASE_ASSETS]);
  }

  @Get(':id/historical')
  @ApiParam({
    name: 'id',
    required: true,
    description: 'The UUID of the coin',
    type: String,
    example: '7a8a03ab-07fe-4c8a-9b5a-50fdfeb9828f'
  })
  @ApiOperation({
    summary: 'Get historical data for coin',
    description: 'Retrieve historical data for a specific coin.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Historical data retrieved successfully.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Coin not found.'
  })
  getCoinHistoricalData(@Param('id', new ParseUUIDPipe()) id: string): Promise<any> {
    return this.coin.getCoinHistoricalData(id);
  }

  @Get('suggested')
  @ApiOperation({
    summary: 'Get suggested coins',
    description: 'Retrieves the suggested coins for the authenticated user based on their risk profile.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of suggested coins retrieved successfully.',
    type: [Coin]
  })
  suggestedCoins(@GetUser() user: User) {
    return this.coin.getCoinsByRiskLevel(user);
  }
}
