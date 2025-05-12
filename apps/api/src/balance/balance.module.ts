import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ExchangeModule } from './../exchange/exchange.module';
import { BalanceController } from './balance.controller';
import { BalanceService } from './balance.service';
import { HistoricalBalance } from './historical-balance.entity';

import { UsersModule } from '../users/users.module';

@Module({
  controllers: [BalanceController],
  imports: [ExchangeModule, UsersModule, TypeOrmModule.forFeature([HistoricalBalance])],
  providers: [BalanceService],
  exports: [BalanceService]
})
export class BalanceModule {}
