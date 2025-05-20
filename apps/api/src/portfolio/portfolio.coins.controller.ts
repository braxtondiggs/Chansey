import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { PortfolioRelations } from './portfolio.entity';
import { PortfolioService } from './portfolio.service';

import GetUser from '../authentication/decorator/get-user.decorator';
import JwtAuthenticationGuard from '../authentication/guard/jwt-authentication.guard';
import { Coin } from '../coin/coin.entity';
import { User } from '../users/users.entity';

@ApiTags('Portfolio')
@ApiBearerAuth('token')
@UseGuards(JwtAuthenticationGuard)
@Controller('portfolio')
export class PortfolioCoinsController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Get('coins')
  @ApiOperation({
    summary: 'Get watchlist coins',
    description: "Retrieves all coins in the user's watchlist (portfolio)"
  })
  @ApiResponse({
    status: 200,
    description: "Returns the list of coins in the user's watchlist"
  })
  async getWatchlistCoins(@GetUser() user: User): Promise<Coin[]> {
    const portfolio = await this.portfolio.getPortfolioByUser(user, [PortfolioRelations.COIN]);
    // Extract and return unique coins
    const coins = portfolio.map((item) => item.coin);
    // Remove duplicates based on coin ID
    return [...new Map(coins.map((coin) => [coin.id, coin])).values()];
  }
}
