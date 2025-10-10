import { Module } from '@nestjs/common';

import { TradingController } from './trading.controller';
import { TradingService } from './trading.service';

import { BalanceModule } from '../balance/balance.module';
import { CoinModule } from '../coin/coin.module';
import { ExchangeModule } from '../exchange/exchange.module';

@Module({
  imports: [BalanceModule, CoinModule, ExchangeModule],
  controllers: [TradingController],
  providers: [TradingService],
  exports: [TradingService]
})
export class TradingModule {}
