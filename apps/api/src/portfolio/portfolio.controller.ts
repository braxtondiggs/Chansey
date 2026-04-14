import { CacheTTL } from '@nestjs/cache-manager';
import { Controller, Get, HttpStatus, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { PortfolioAggregationService } from './portfolio-aggregation.service';

import GetUser from '../authentication/decorator/get-user.decorator';
import { JwtAuthenticationGuard } from '../authentication/guard/jwt-authentication.guard';
import { UserPerformanceService } from '../strategy/user-performance.service';
import { User } from '../users/users.entity';
import { UseCacheKey } from '../utils/decorators/use-cache-key.decorator';
import { CustomCacheInterceptor } from '../utils/interceptors/custom-cache.interceptor';

@ApiTags('Portfolio')
@ApiBearerAuth('token')
@UseGuards(JwtAuthenticationGuard)
@ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
@Controller('portfolio')
export class PortfolioController {
  constructor(
    private readonly portfolioAggregation: PortfolioAggregationService,
    private readonly userPerformance: UserPerformanceService
  ) {}

  @Get('summary')
  @UseInterceptors(CustomCacheInterceptor)
  @UseCacheKey((ctx) => `portfolio:summary:${ctx.switchToHttp().getRequest().user.id}`)
  @CacheTTL(30_000)
  @ApiOperation({
    summary: 'Get aggregated algo trading portfolio',
    description: 'Retrieves the aggregated portfolio across all algo trading strategies, combining positions by symbol.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Aggregated algo trading portfolio retrieved successfully.'
  })
  async getAlgoPortfolio(@GetUser() user: User) {
    return this.portfolioAggregation.getAggregatedPortfolio(user.id);
  }

  @Get('performance')
  @UseInterceptors(CustomCacheInterceptor)
  @UseCacheKey((ctx) => `portfolio:performance:${ctx.switchToHttp().getRequest().user.id}`)
  @CacheTTL(60_000)
  @ApiOperation({
    summary: 'Get algo trading performance metrics',
    description:
      'Retrieves overall performance metrics for algorithmic trading including total P&L, returns, and win rate.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Algo trading performance metrics retrieved successfully.'
  })
  async getAlgoPerformance(@GetUser() user: User) {
    return this.userPerformance.getUserAlgoPerformance(user.id);
  }

  @Get('positions')
  @UseInterceptors(CustomCacheInterceptor)
  @UseCacheKey((ctx) => `portfolio:positions:${ctx.switchToHttp().getRequest().user.id}`)
  @CacheTTL(30_000)
  @ApiOperation({
    summary: 'Get all algo trading positions',
    description: 'Retrieves all positions across all strategies, grouped by strategy.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Algo trading positions retrieved successfully.'
  })
  async getAlgoPositions(@GetUser() user: User) {
    return this.portfolioAggregation.getPositionsByStrategy(user.id);
  }

  @Get('performance/by-strategy')
  @UseInterceptors(CustomCacheInterceptor)
  @UseCacheKey((ctx) => `portfolio:perf-by-strategy:${ctx.switchToHttp().getRequest().user.id}`)
  @CacheTTL(60_000)
  @ApiOperation({
    summary: 'Get performance breakdown by strategy',
    description: 'Shows which strategies are performing best/worst with individual P&L metrics.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Performance breakdown by strategy retrieved successfully.'
  })
  async getPerformanceByStrategy(@GetUser() user: User) {
    return this.userPerformance.getPerformanceByStrategy(user.id);
  }

  @Get('allocation')
  @UseInterceptors(CustomCacheInterceptor)
  @UseCacheKey((ctx) => `portfolio:allocation:${ctx.switchToHttp().getRequest().user.id}`)
  @CacheTTL(30_000)
  @ApiOperation({
    summary: 'Get portfolio allocation breakdown',
    description: 'Shows allocation percentages by symbol across all algo trading positions.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Allocation breakdown retrieved successfully.'
  })
  async getAllocationBreakdown(@GetUser() user: User) {
    return this.portfolioAggregation.getAllocationBreakdown(user.id);
  }
}
