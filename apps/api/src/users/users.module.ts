import { BullModule } from '@nestjs/bullmq';
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Coin } from './../coin/coin.entity';
import { CoinService } from './../coin/coin.service';
import { Portfolio } from './../portfolio/portfolio.entity';
import { PortfolioService } from './../portfolio/portfolio.service';
import { UsersTaskService } from './tasks/users.task';
import { UserController } from './users.controller';
import { User } from './users.entity';
import { UsersService } from './users.service';

import { AppModule } from '../app.module';
import { ExchangeKeyModule } from '../exchange/exchange-key/exchange-key.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { Risk } from '../risk/risk.entity';
import { StorageModule } from '../storage/storage.module';

@Module({
  controllers: [UserController],
  imports: [
    forwardRef(() => AppModule),
    TypeOrmModule.forFeature([Coin, Risk, Portfolio, User]),
    forwardRef(() => ExchangeModule),
    forwardRef(() => ExchangeKeyModule),
    StorageModule,
    BullModule.registerQueue({ name: 'user-queue' })
  ],
  providers: [CoinService, PortfolioService, UsersService, UsersTaskService],
  exports: [UsersService]
})
export class UsersModule {}
