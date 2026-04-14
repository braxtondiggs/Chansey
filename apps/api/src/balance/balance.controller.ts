import { CacheTTL } from '@nestjs/cache-manager';
import { Controller, Get, UseGuards, Query, HttpStatus, UseInterceptors, Logger } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { BalanceHistoryService } from './balance-history.service';
import { BalanceService } from './balance.service';
import { BalanceResponseDto, AccountValueHistoryDto, AssetDetailsDto } from './dto';

import GetUser from '../authentication/decorator/get-user.decorator';
import { JwtAuthenticationGuard } from '../authentication/guard/jwt-authentication.guard';
import { User } from '../users/users.entity';
import { UseCacheKey } from '../utils/decorators/use-cache-key.decorator';
import { CustomCacheInterceptor } from '../utils/interceptors/custom-cache.interceptor';

@ApiTags('Balance')
@ApiBearerAuth('token')
@UseGuards(JwtAuthenticationGuard)
@ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
@Controller('balance')
export class BalanceController {
  private readonly logger = new Logger(BalanceController.name);

  constructor(
    private readonly balanceService: BalanceService,
    private readonly balanceHistoryService: BalanceHistoryService
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get user balances from all connected exchanges',
    description: 'Returns balance information from all exchanges the user has connected'
  })
  @UseInterceptors(CustomCacheInterceptor)
  @UseCacheKey((ctx) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    // Include query parameters in cache key to properly handle different parameter combinations
    const includeHistorical = request.query.includeHistorical === 'true';
    const period = request.query.period || [];
    const periods = Array.isArray(period) ? period.join('-') : period;
    return `user-balance:${user.id}:${includeHistorical}:${periods}`;
  })
  @CacheTTL(60_000) // 1 minute in ms
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved balances',
    type: BalanceResponseDto
  })
  @ApiQuery({
    name: 'includeHistorical',
    description: 'Whether to include historical balance data',
    required: false,
    type: Boolean
  })
  @ApiQuery({
    name: 'period',
    description: 'Historical periods to include (can specify multiple)',
    required: false,
    isArray: true,
    enum: ['24h', '7d', '30d']
  })
  async getBalances(
    @GetUser() user: User,
    @Query('includeHistorical') includeHistorical?: boolean,
    @Query('period') period?: string | string[]
  ): Promise<BalanceResponseDto> {
    this.logger.log(
      `getBalances called for user: ${user.id}, includeHistorical: ${includeHistorical}, period: ${period}`
    );
    const response = await this.balanceService.getUserBalances(user);

    const periods = period ? (Array.isArray(period) ? period : [period]) : [];
    if (includeHistorical && periods.length > 0) {
      response.historical = await this.balanceHistoryService.getHistoricalBalances(user, periods);
    }

    return response;
  }

  @Get('history')
  @UseCacheKey((ctx) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    const days = request.query.days || 30;
    return `account-value-history:${user.id}:${days}`;
  })
  @CacheTTL(900_000) // 15 minutes in ms
  @UseInterceptors(CustomCacheInterceptor)
  @ApiOperation({
    summary: 'Get account value history',
    description: 'Returns the total account value over time across all exchanges with hourly data points'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved account value history',
    type: AccountValueHistoryDto
  })
  @ApiQuery({
    name: 'days',
    description: 'Number of days to look back',
    required: false,
    type: Number
  })
  async getAccountValueHistory(@GetUser() user: User, @Query('days') days?: number): Promise<AccountValueHistoryDto> {
    let currentBalances;
    try {
      currentBalances = await this.balanceService.getCurrentBalances(user);
    } catch {
      this.logger.warn(`Couldn't fetch current balances for account value history, falling back to historical`);
    }
    return this.balanceHistoryService.getAccountValueHistory(user, days || 30, currentBalances);
  }

  @Get('assets')
  @UseCacheKey((ctx) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return `user-assets:${user.id}`;
  })
  @CacheTTL(900_000) // 15 minutes in ms
  @UseInterceptors(CustomCacheInterceptor)
  @ApiOperation({
    summary: 'Get detailed assets with current prices and values',
    description: 'Returns a list of assets the user has with their current prices and values'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved asset details',
    type: [AssetDetailsDto]
  })
  async getUserAssets(@GetUser() user: User): Promise<AssetDetailsDto[]> {
    return this.balanceService.getUserAssetDetails(user);
  }
}
