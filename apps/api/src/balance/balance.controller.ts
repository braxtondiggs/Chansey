import { CacheTTL } from '@nestjs/cache-manager';
import { Controller, Get, UseGuards, Query, HttpStatus, UseInterceptors, Logger } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { BalanceService } from './balance.service';
import { BalanceResponseDto, AccountValueHistoryDto, AssetDetailsDto } from './dto';

import GetUser from '../authentication/decorator/get-user.decorator';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';
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

  constructor(private readonly balanceService: BalanceService) {}

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
  @CacheTTL(60)
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
    const periods = period ? (Array.isArray(period) ? period : [period]) : [];
    return this.balanceService.getUserBalances(user, includeHistorical, periods);
  }

  @Get('history')
  @UseCacheKey((ctx) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    const days = request.query.days || 30;
    return `account-value-history:${user.id}:${days}`;
  })
  @CacheTTL(900) // 15 minutes in seconds
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
    return this.balanceService.getAccountValueHistory(user, days || 30);
  }

  @Get('assets')
  @UseCacheKey((ctx) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return `user-assets:${user.id}`;
  })
  @CacheTTL(900) // 15 minutes in seconds
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
