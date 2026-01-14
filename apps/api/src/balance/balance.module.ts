import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BalanceController } from './balance.controller';
import { BalanceService } from './balance.service';
import { HistoricalBalance } from './historical-balance.entity';
import { BalanceSyncTask } from './tasks/balance-sync.task';

import { CoinModule } from '../coin/coin.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { SharedCacheModule } from '../shared-cache.module';
import { UsersModule } from '../users/users.module';
import { CustomCacheInterceptor } from '../utils/interceptors/custom-cache.interceptor';

@Module({
  controllers: [BalanceController],
  imports: [
    TypeOrmModule.forFeature([HistoricalBalance]),
    BullModule.registerQueue({ name: 'balance-queue' }),
    SharedCacheModule,
    forwardRef(() => CoinModule),
    forwardRef(() => ExchangeModule),
    forwardRef(() => UsersModule)
  ],
  providers: [BalanceService, BalanceSyncTask, CustomCacheInterceptor],
  exports: [BalanceService]
})
export class BalanceModule {}
