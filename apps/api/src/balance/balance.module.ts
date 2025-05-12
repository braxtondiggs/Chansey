import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BalanceController } from './balance.controller';
import { BalanceService } from './balance.service';
import { HistoricalBalance } from './historical-balance.entity';

import { ExchangeModule } from '../exchange/exchange.module';

@Module({
  controllers: [BalanceController],
  imports: [ExchangeModule, TypeOrmModule.forFeature([HistoricalBalance])],
  providers: [BalanceService],
  exports: [BalanceService]
})
export class BalanceModule {}
