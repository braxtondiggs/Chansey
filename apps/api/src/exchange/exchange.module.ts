import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BinanceUSService } from './binance/binance-us.service';
import { CoinbaseService } from './coinbase/coinbase.service';
import { CoinbaseExchangeService } from './coinbase-exchange/coinbase-exchange.service';
import { ExchangeKey } from './exchange-key/exchange-key.entity';
import { ExchangeKeyModule } from './exchange-key/exchange-key.module';
import { ExchangeManagerService } from './exchange-manager.service';
import { ExchangeController } from './exchange.controller';
import { Exchange } from './exchange.entity';
import { ExchangeService } from './exchange.service';
import { EXCHANGE_MANAGER_SERVICE, EXCHANGE_SERVICE } from './interfaces';
import { KrakenFuturesService } from './kraken/kraken-futures.service';
import { KrakenService } from './kraken/kraken.service';
import { ExchangeSyncTask } from './tasks/exchange-sync.task';
import { tickerBatcherConfig } from './ticker-batcher/ticker-batcher.config';
import { TickerBatcherService } from './ticker-batcher/ticker-batcher.service';

import { CoinDailySnapshot } from '../coin/coin-daily-snapshot.entity';
import { CoinDailySnapshotService } from '../coin/coin-daily-snapshot.service';
import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';
import { TickerPairs } from '../coin/ticker-pairs/ticker-pairs.entity';
import { TickerPairService } from '../coin/ticker-pairs/ticker-pairs.service';
import { SharedCacheModule } from '../shared-cache.module';

@Global()
@Module({
  controllers: [ExchangeController],
  imports: [
    ConfigModule.forFeature(tickerBatcherConfig),
    TypeOrmModule.forFeature([Coin, CoinDailySnapshot, Exchange, ExchangeKey, TickerPairs]),
    forwardRef(() => ExchangeKeyModule),
    SharedCacheModule,
    BullModule.registerQueue({ name: 'exchange-queue' })
  ],
  providers: [
    BinanceUSService,
    CoinbaseService,
    CoinbaseExchangeService,
    KrakenService,
    KrakenFuturesService,
    CoinDailySnapshotService,
    CoinService,
    ExchangeService,
    {
      provide: EXCHANGE_SERVICE,
      useExisting: ExchangeService
    },
    ExchangeSyncTask,
    ExchangeManagerService,
    {
      provide: EXCHANGE_MANAGER_SERVICE,
      useExisting: ExchangeManagerService
    },
    TickerPairService,
    TickerBatcherService
  ],
  exports: [
    ExchangeService,
    EXCHANGE_SERVICE,
    BinanceUSService,
    CoinbaseService,
    CoinbaseExchangeService,
    KrakenService,
    KrakenFuturesService,
    ExchangeManagerService,
    EXCHANGE_MANAGER_SERVICE,
    TickerBatcherService
  ]
})
export class ExchangeModule {}
