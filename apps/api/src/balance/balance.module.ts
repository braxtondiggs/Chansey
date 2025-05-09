import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { BalanceController } from './balance.controller';
import { BalanceService } from './balance.service';

import { ExchangeKeyModule } from '../exchange/exchange-key/exchange-key.module';
import { ExchangeModule } from '../exchange/exchange.module';

@Module({
  controllers: [BalanceController],
  imports: [ConfigModule, ExchangeModule, ExchangeKeyModule],
  providers: [BalanceService],
  exports: [BalanceService]
})
export class BalanceModule {}
