import { BullModule } from '@nestjs/bullmq';
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CoinDailySnapshot } from './coin-daily-snapshot.entity';
import { CoinDailySnapshotService } from './coin-daily-snapshot.service';
import { CoinListingEvent } from './coin-listing-event.entity';
import { CoinListingEventService } from './coin-listing-event.service';
import { CoinMarketDataService } from './coin-market-data.service';
import { CoinController, CoinsController } from './coin.controller';
import { Coin } from './coin.entity';
import { CoinService } from './coin.service';
import { SimplePriceController } from './simple-price.controller';
import { CoinDetailSyncService } from './tasks/coin-detail-sync.service';
import { CoinSnapshotPruneTask } from './tasks/coin-snapshot-prune.task';
import { CoinSyncTask } from './tasks/coin-sync.task';
import { TickerPairSyncTask } from './ticker-pairs/tasks/ticker-pairs-sync.task';
import { TickerPairs } from './ticker-pairs/ticker-pairs.entity';
import { TickerPairService } from './ticker-pairs/ticker-pairs.service';

import { CoinSelection } from '../coin-selection/coin-selection.entity';
import { ExchangeKeyModule } from '../exchange/exchange-key/exchange-key.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { OrderModule } from '../order/order.module';
import { RiskModule } from '../risk/risk.module';
import { SharedCacheModule } from '../shared-cache.module';

@Module({
  controllers: [CoinController, CoinsController, SimplePriceController],
  exports: [
    CoinService,
    CoinDailySnapshotService,
    CoinListingEventService,
    CoinMarketDataService,
    TickerPairService,
    TickerPairSyncTask
  ],
  imports: [
    TypeOrmModule.forFeature([Coin, CoinDailySnapshot, CoinSelection, TickerPairs, CoinListingEvent]),
    forwardRef(() => ExchangeModule),
    forwardRef(() => ExchangeKeyModule),
    forwardRef(() => OrderModule),
    RiskModule,
    SharedCacheModule,
    BullModule.registerQueue({ name: 'coin-queue' }),
    BullModule.registerQueue({ name: 'coin-snapshot-prune-queue' }),
    BullModule.registerQueue({ name: 'ticker-pairs-queue' })
  ],
  providers: [
    CoinService,
    CoinDailySnapshotService,
    CoinListingEventService,
    CoinMarketDataService,
    CoinDetailSyncService,
    CoinSnapshotPruneTask,
    CoinSyncTask,
    TickerPairService,
    TickerPairSyncTask
  ]
})
export class CoinModule {}
