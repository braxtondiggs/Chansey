import { BullModule } from '@nestjs/bullmq';
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Coin } from './../coin/coin.entity';
import { CoinService } from './../coin/coin.service';
import { UsersTaskService } from './tasks/users.task';
import { UserController } from './users.controller';
import { User } from './users.entity';
import { UsersService } from './users.service';

import { ExchangeKeyModule } from '../exchange/exchange-key/exchange-key.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { Risk } from '../risk/risk.entity';
import { SharedCacheModule } from '../shared-cache.module';
import { StorageModule } from '../storage/storage.module';
import { StrategyModule } from '../strategy/strategy.module';

@Module({
  controllers: [UserController],
  imports: [
    TypeOrmModule.forFeature([Coin, Risk, User]),
    forwardRef(() => ExchangeModule),
    forwardRef(() => ExchangeKeyModule),
    forwardRef(() => PortfolioModule),
    forwardRef(() => StrategyModule),
    SharedCacheModule,
    StorageModule,
    BullModule.registerQueue({ name: 'user-queue' })
  ],
  providers: [CoinService, UsersService, UsersTaskService],
  exports: [UsersService]
})
export class UsersModule {}
