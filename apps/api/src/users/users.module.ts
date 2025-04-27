import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Coin } from './../coin/coin.entity';
import { CoinService } from './../coin/coin.service';
import { BinanceService } from './../exchange/binance/binance.service';
import { Portfolio } from './../portfolio/portfolio.entity';
import { PortfolioService } from './../portfolio/portfolio.service';
import { UserController } from './users.controller';
import { User } from './users.entity';
import { UsersService } from './users.service';
import { UsersTaskService } from './users.task';

import { AppModule } from '../app.module';
import { Risk } from '../risk/risk.entity';
import { HealthCheckHelper } from '../utils/health-check.helper';

@Module({
  controllers: [UserController],
  imports: [forwardRef(() => AppModule), TypeOrmModule.forFeature([Coin, Risk, Portfolio, User])],
  providers: [CoinService, BinanceService, HealthCheckHelper, PortfolioService, UsersService, UsersTaskService],
  exports: [UsersService]
})
export class UsersModule {}
