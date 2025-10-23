import { BullModule } from '@nestjs/bullmq';
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PriceModule } from '@chansey-api/price/price.module';

import { CoinController, CoinsController } from './coin.controller';
import { Coin } from './coin.entity';
import { CoinService } from './coin.service';
import { CoinSyncTask } from './tasks/coin-sync.task';
import { TickerPairSyncTask } from './ticker-pairs/tasks/ticker-pairs-sync.task';
import { TickerPairs } from './ticker-pairs/ticker-pairs.entity';
import { TickerPairService } from './ticker-pairs/ticker-pairs.service';

import { AppModule } from '../app.module';
import { ExchangeKeyModule } from '../exchange/exchange-key/exchange-key.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { OrderModule } from '../order/order.module';
import { Portfolio } from '../portfolio/portfolio.entity';
import { SharedCacheModule } from '../shared-cache.module';

@Module({
  controllers: [CoinController, CoinsController],
  exports: [CoinService, TickerPairService, TickerPairSyncTask],
  imports: [
    forwardRef(() => AppModule),
    TypeOrmModule.forFeature([Coin, Portfolio, TickerPairs]),
    forwardRef(() => ExchangeModule),
    forwardRef(() => ExchangeKeyModule),
    forwardRef(() => PriceModule),
    forwardRef(() => OrderModule),
    SharedCacheModule,
    BullModule.registerQueue({ name: 'coin-queue' }),
    BullModule.registerQueue({ name: 'ticker-pairs-queue' })
  ],
  providers: [CoinService, CoinSyncTask, TickerPairService, TickerPairSyncTask]
})
export class CoinModule {}
