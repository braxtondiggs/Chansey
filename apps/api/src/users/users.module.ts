import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

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
  imports: [ConfigModule, TypeOrmModule.forFeature([Coin, Risk, Portfolio, User])],
  providers: [CoinService, BinanceService, PortfolioService, UsersService, UsersTaskService],
  exports: [UsersService]
})
export class UsersModule {}
