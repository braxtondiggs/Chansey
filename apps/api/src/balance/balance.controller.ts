import { Controller, Get, UseGuards, Query, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { BalanceService } from './balance.service';
import { BalanceResponseDto, AccountValueHistoryDto } from './dto';

import GetUser from '../authentication/decorator/get-user.decorator';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';
import { User } from '../users/users.entity';

@ApiTags('Balance')
@ApiBearerAuth('token')
@UseGuards(JwtAuthenticationGuard)
@ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
@Controller('balance')
export class BalanceController {
  constructor(private readonly balanceService: BalanceService) {}

  @Get()
  @ApiOperation({
    summary: 'Get user balances from all connected exchanges',
    description: 'Returns balance information from all exchanges the user has connected'
  })
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
    const periods = period ? (Array.isArray(period) ? period : [period]) : [];
    return this.balanceService.getUserBalances(user, includeHistorical, periods);
  }

  @Get('history')
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
}
