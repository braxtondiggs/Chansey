import { Controller, Get, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { PortfolioAggregationService } from './portfolio-aggregation.service';

import GetUser from '../authentication/decorator/get-user.decorator';
import { JwtAuthenticationGuard } from '../authentication/guard/jwt-authentication.guard';
import { UserPerformanceService } from '../strategy/user-performance.service';
import { User } from '../users/users.entity';

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
