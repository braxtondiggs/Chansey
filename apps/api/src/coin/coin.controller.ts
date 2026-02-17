import {
  BadRequestException,
  Controller,
  Get,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CoinDetailResponseDto, MarketChartResponseDto, TimePeriod, UserHoldingsDto } from '@chansey/api-interfaces';

import { Coin, CoinRelations } from './coin.entity';
import { CoinService } from './coin.service';
import { CoinResponseDto, CoinWithPriceDto } from './dto';

import GetUser from '../authentication/decorator/get-user.decorator';
import { JwtAuthenticationGuard } from '../authentication/guard/jwt-authentication.guard';
import { OrderService } from '../order/order.service';
import { toErrorInfo } from '../shared/error.util';
import { User } from '../users/users.entity';

@ApiTags('Coin')
@ApiBearerAuth('token')
@UseGuards(JwtAuthenticationGuard)
@ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Invalid credentials' })
@Controller('coin')
export class CoinController {
  constructor(
    private readonly coin: CoinService,
    private readonly orderService: OrderService
  ) {}

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
  getCoinBySymbol(@Param() { symbol }: { symbol: string }): Promise<Coin | null> {
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

/**
 * Coin Detail Page Controller
 * Handles endpoints for the dedicated coin detail page feature
 * Routes: /coins/:slug (plural to differentiate from legacy /coin routes)
 */
@ApiTags('Coins - Detail Page')
@Controller('coins')
export class CoinsController {
  private readonly logger = new Logger(CoinsController.name);

  constructor(
    private readonly coinService: CoinService,
    private readonly orderService: OrderService
  ) {}

  /**
   * T020: GET /coins/:slug - Get comprehensive coin detail
   * Optional authentication - returns userHoldings only if authenticated
   */
  @Get(':slug')
  @ApiOperation({
    summary: 'Get coin detail by slug',
    description:
      'Retrieve comprehensive coin information including market data, description, and links. ' +
      'Optionally includes user holdings if authenticated.'
  })
  @ApiParam({
    name: 'slug',
    required: true,
    description: 'Coin slug (e.g., "bitcoin", "ethereum")',
    type: String,
    example: 'bitcoin'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Coin detail retrieved successfully.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Coin not found.'
  })
  async getCoinDetail(@Param('slug') slug: string, @Req() req: any): Promise<CoinDetailResponseDto> {
    // Get base coin detail
    const coinDetail = await this.coinService.getCoinDetailBySlug(slug);

    // If user is authenticated, add holdings data
    if (req.user) {
      try {
        const coin = await this.coinService.getCoinBySlug(slug);
        if (coin) {
          const holdings = await this.orderService.getHoldingsByCoin(req.user, coin);
          // Only add holdings if user has any
          if (holdings.totalAmount > 0) {
            (coinDetail as any).userHoldings = holdings;
          }
        }
      } catch (error: unknown) {
        // If holdings fetch fails, just return coin detail without holdings
        const err = toErrorInfo(error);
        this.logger.error(`Failed to fetch user holdings: ${err.message}`, err.stack);
      }
    }

    return coinDetail;
  }

  /**
   * T021: GET /coins/:slug/chart - Get market chart data
   */
  @Get(':slug/chart')
  @ApiOperation({
    summary: 'Get market chart data for coin',
    description: 'Retrieve historical price data for specified time period.'
  })
  @ApiParam({
    name: 'slug',
    required: true,
    description: 'Coin slug (e.g., "bitcoin")',
    type: String,
    example: 'bitcoin'
  })
  @ApiQuery({
    name: 'period',
    required: true,
    description: 'Time period for chart data',
    enum: ['24h', '7d', '30d', '1y'],
    example: '7d'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Market chart data retrieved successfully.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Coin not found.'
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid period parameter.'
  })
  async getMarketChart(
    @Param('slug') slug: string,
    @Query('period') period: TimePeriod
  ): Promise<MarketChartResponseDto> {
    // Validate period
    const validPeriods: TimePeriod[] = ['24h', '7d', '30d', '1y'];
    if (!validPeriods.includes(period)) {
      throw new BadRequestException(`Invalid period. Must be one of: ${validPeriods.join(', ')}`);
    }

    return this.coinService.getMarketChart(slug, period);
  }

  /**
   * T022: GET /coins/:slug/holdings - Get user holdings for coin
   * Requires authentication
   */
  @Get(':slug/holdings')
  @UseGuards(JwtAuthenticationGuard)
  @ApiBearerAuth('token')
  @ApiOperation({
    summary: 'Get user holdings for coin',
    description:
      "Retrieve authenticated user's holdings for a specific coin, including profit/loss and exchange breakdown."
  })
  @ApiParam({
    name: 'slug',
    required: true,
    description: 'Coin slug (e.g., "bitcoin")',
    type: String,
    example: 'bitcoin'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'User holdings retrieved successfully.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Coin not found.'
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication required.'
  })
  async getHoldings(@Param('slug') slug: string, @GetUser() user: User): Promise<UserHoldingsDto> {
    const coin = await this.coinService.getCoinBySlug(slug);
    if (!coin) {
      throw new Error(`Coin with slug '${slug}' not found`);
    }

    return this.orderService.getHoldingsByCoin(user, coin);
  }
}
