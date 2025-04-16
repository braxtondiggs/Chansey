import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppModule } from '../app.module';
import { HealthCheckHelper } from '../utils/health-check.helper';
import { Coin } from './../coin/coin.entity';
import { CoinService } from './../coin/coin.service';
import { BinanceService } from './../exchange/binance/binance.service';
import { Portfolio } from './../portfolio/portfolio.entity';
import { PortfolioService } from './../portfolio/portfolio.service';
import { Risk } from './risk.entity';
import { UserController } from './users.controller';
import { User } from './users.entity';
import { UsersService } from './users.service';
import { UsersTaskService } from './users.task';

@Module({
  controllers: [UserController],
  imports: [forwardRef(() => AppModule), TypeOrmModule.forFeature([Coin, Risk, Portfolio, User])],
  providers: [
    CoinService,
    BinanceService,
    HealthCheckHelper,
    PortfolioService,
    UsersService,
    UsersTaskService
  ],
  exports: [UsersService]
})
export class UsersModule {}
