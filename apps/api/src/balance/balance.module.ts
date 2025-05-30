import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ExchangeModule } from './../exchange/exchange.module';
import { BalanceController } from './balance.controller';
import { BalanceService } from './balance.service';
import { HistoricalBalance } from './historical-balance.entity';

import { CoinModule } from '../coin/coin.module';
import { SharedCacheModule } from '../shared-cache.module';
import { UsersModule } from '../users/users.module';
import { CustomCacheInterceptor } from '../utils/interceptors/custom-cache.interceptor';

@Module({
  controllers: [BalanceController],
  imports: [CoinModule, ExchangeModule, UsersModule, SharedCacheModule, TypeOrmModule.forFeature([HistoricalBalance])],
  providers: [BalanceService, CustomCacheInterceptor],
  exports: [BalanceService]
})
export class BalanceModule {}
