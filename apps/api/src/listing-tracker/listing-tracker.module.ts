import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, forwardRef, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BinanceAnnouncementClient } from './clients/binance-announcement.client';
import { CoinbaseAnnouncementClient } from './clients/coinbase-announcement.client';
import { KrakenAnnouncementClient } from './clients/kraken-announcement.client';
import { ListingAnnouncement } from './entities/listing-announcement.entity';
import { ListingCandidate } from './entities/listing-candidate.entity';
import { ListingTradePosition } from './entities/listing-trade-position.entity';
import { ListingExitListener } from './listeners/listing-exit.listener';
import { ListingTrackerController } from './listing-tracker.controller';
import { AnnouncementPollerService } from './services/announcement-poller.service';
import { CrossListingScorerService } from './services/cross-listing-scorer.service';
import { CrossListingTickerSeedService } from './services/cross-listing-ticker-seed.service';
import { DefiLlamaClientService } from './services/defi-llama-client.service';
import { ListingHedgeService } from './services/listing-hedge.service';
import { LISTING_TRADE_EXECUTION_QUEUE, ListingTrackerService } from './services/listing-tracker.service';
import { ListingTradeExecutorService } from './services/listing-trade-executor.service';
import { AnnouncementPollTask, LISTING_ANNOUNCEMENT_POLL_QUEUE } from './tasks/announcement-poll.task';
import { CrossListingTickerSeedTask, LISTING_CROSS_LISTING_SEED_QUEUE } from './tasks/cross-listing-ticker-seed.task';
import { LISTING_SCORE_QUEUE, ListingScoreTask } from './tasks/listing-score.task';
import { LISTING_TIME_STOP_QUEUE, ListingTimeStopTask } from './tasks/listing-time-stop.task';
import { ListingTradeExecutionTask } from './tasks/listing-trade-execution.task';

import { BalanceModule } from '../balance/balance.module';
import { Coin } from '../coin/coin.entity';
import { ExchangeTickerFetcherService } from '../coin/ticker-pairs/services/exchange-ticker-fetcher.service';
import { TickerPairs } from '../coin/ticker-pairs/ticker-pairs.entity';
import { CoinSelectionModule } from '../coin-selection/coin-selection.module';
import { ExchangeKey } from '../exchange/exchange-key/exchange-key.entity';
import { ExchangeKeyModule } from '../exchange/exchange-key/exchange-key.module';
import { Exchange } from '../exchange/exchange.entity';
import { ExchangeModule } from '../exchange/exchange.module';
import { MetricsModule } from '../metrics/metrics.module';
import { Order } from '../order/order.entity';
import { OrderModule } from '../order/order.module';
import { SharedCacheModule } from '../shared-cache.module';
import { StrategyModule } from '../strategy/strategy.module';
import { User } from '../users/users.entity';

const LISTING_QUEUES = [
  LISTING_ANNOUNCEMENT_POLL_QUEUE,
  LISTING_SCORE_QUEUE,
  LISTING_TRADE_EXECUTION_QUEUE,
  LISTING_TIME_STOP_QUEUE,
  LISTING_CROSS_LISTING_SEED_QUEUE
];

/**
 * ListingTrackerModule
 *
 * Event-driven trading module that reacts to exchange listing announcements
 * and cross-listing scoring, enqueueing trades for eligible risk-4/5 users.
 *
 * BullMQ queues register unconditionally so that BullBoard picks them up and
 * admin operations (manual enqueue, retry) work even with the feature flag
 * off. The *schedulers* (polling cron, scoring cron, time-stop cron) check
 * `LISTING_TRACKER_ENABLED` at `onModuleInit` and no-op when false.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ListingAnnouncement,
      ListingCandidate,
      ListingTradePosition,
      Coin,
      TickerPairs,
      Exchange,
      ExchangeKey,
      Order,
      User
    ]),
    ...LISTING_QUEUES.map((name) => BullModule.registerQueue({ name })),
    ConfigModule,
    SharedCacheModule,
    MetricsModule,
    forwardRef(() => OrderModule),
    forwardRef(() => ExchangeModule),
    forwardRef(() => ExchangeKeyModule),
    forwardRef(() => BalanceModule),
    forwardRef(() => CoinSelectionModule),
    forwardRef(() => StrategyModule)
  ],
  controllers: [ListingTrackerController],
  providers: [
    // Clients
    BinanceAnnouncementClient,
    CoinbaseAnnouncementClient,
    KrakenAnnouncementClient,
    DefiLlamaClientService,
    // Services
    AnnouncementPollerService,
    CrossListingScorerService,
    CrossListingTickerSeedService,
    ExchangeTickerFetcherService,
    ListingTradeExecutorService,
    ListingHedgeService,
    ListingTrackerService,
    // Tasks
    AnnouncementPollTask,
    ListingScoreTask,
    ListingTradeExecutionTask,
    ListingTimeStopTask,
    CrossListingTickerSeedTask,
    // Listeners
    ListingExitListener
  ],
  exports: [ListingTrackerService, ListingTradeExecutorService, CrossListingScorerService]
})
export class ListingTrackerModule {
  /**
   * `register()` kept as an escape hatch for future per-environment queue
   * routing — today it returns the same shape as the static decorator metadata.
   */
  static register(): DynamicModule {
    return {
      module: ListingTrackerModule,
      imports: [ConfigModule]
    };
  }

  static forRootAsync(): DynamicModule {
    return {
      module: ListingTrackerModule,
      imports: [ConfigModule],
      providers: [
        {
          provide: 'LISTING_TRACKER_FEATURE_FLAG',
          inject: [ConfigService],
          useFactory: (configService: ConfigService) => configService.get<string>('LISTING_TRACKER_ENABLED') === 'true'
        }
      ],
      exports: ['LISTING_TRACKER_FEATURE_FLAG']
    };
  }
}

export const LISTING_TRACKER_QUEUE_NAMES = LISTING_QUEUES;
