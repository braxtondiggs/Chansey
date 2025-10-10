import { Controller, Get, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { OrderBookDto, TickerDto, TradingBalanceDto } from './dto';
import { TradingService } from './trading.service';

import GetUser from '../authentication/decorator/get-user.decorator';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';
import { User } from '../users/users.entity';

@ApiTags('Trading')
@ApiBearerAuth('token')
@UseGuards(JwtAuthenticationGuard)
@ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
@Controller('trading')
export class TradingController {
  constructor(private readonly tradingService: TradingService) {}

  @Get('balances')
  @ApiOperation({
    summary: 'Get trading balances',
    description: 'Returns available trading balances for the user, optionally filtered by exchange'
  })
  @ApiQuery({
    name: 'exchangeId',
    description: 'Optional exchange ID to filter balances',
    required: false,
    type: String
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved trading balances',
    type: [TradingBalanceDto]
  })
  async getTradingBalances(
    @GetUser() user: User,
    @Query('exchangeId') exchangeId?: string
  ): Promise<TradingBalanceDto[]> {
    return this.tradingService.getTradingBalances(user, exchangeId);
  }

  @Get('orderbook')
  @ApiOperation({
    summary: 'Get order book for a trading pair',
    description: 'Returns current order book (bids and asks) for the specified trading pair'
  })
  @ApiQuery({
    name: 'symbol',
    description: 'Trading pair symbol (e.g., BTC/USDT)',
    required: true,
    type: String
  })
  @ApiQuery({
    name: 'exchangeId',
    description: 'Optional exchange ID',
    required: false,
    type: String
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved order book',
    type: OrderBookDto
  })
  async getOrderBook(@Query('symbol') symbol: string, @Query('exchangeId') exchangeId?: string): Promise<OrderBookDto> {
    return this.tradingService.getOrderBook(symbol, exchangeId);
  }

  @Get('ticker')
  @ApiOperation({
    summary: 'Get ticker data for a trading pair',
    description: 'Returns current ticker information including price, volume, and 24h statistics'
  })
  @ApiQuery({
    name: 'symbol',
    description: 'Trading pair symbol (e.g., BTC/USDT)',
    required: true,
    type: String
  })
  @ApiQuery({
    name: 'exchangeId',
    description: 'Optional exchange ID',
    required: false,
    type: String
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved ticker data',
    type: TickerDto
  })
  async getTicker(@Query('symbol') symbol: string, @Query('exchangeId') exchangeId?: string): Promise<TickerDto> {
    return this.tradingService.getTicker(symbol, exchangeId);
  }
}
