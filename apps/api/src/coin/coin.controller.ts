import { Controller, Get, HttpStatus, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Coin, CoinRelations } from './coin.entity';
import { CoinService } from './coin.service';
import { CoinResponseDto } from './dto';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';

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
    type: [CoinResponseDto]
  })
  async getCoins(): Promise<CoinResponseDto[]> {
    return this.coin.getCoins();
  }

  @Get(':id')
  @ApiParam({
    name: 'id',
    required: true,
    description: 'The UUID of the coin',
    type: String,
    example: '123e4567-e89b-12d3-a456-426614174000'
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
  getCoinById(@Param('id', new ParseUUIDPipe()) id: string): Promise<CoinResponseDto> {
    return this.coin.getCoinById(id, [CoinRelations.TICKERS]);
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
    return this.coin.getCoinBySymbol(symbol, [CoinRelations.TICKERS]);
  }

  @Get(':id/historical')
  @ApiParam({
    name: 'id',
    required: true,
    description: 'The UUID of the coin',
    type: String,
    example: '123e4567-e89b-12d3-a456-426614174000'
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
}
