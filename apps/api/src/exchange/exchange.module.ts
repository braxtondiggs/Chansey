import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BinanceUSService } from './binance/binance-us.service';
import { CoinbaseExchangeService } from './coinbase-exchange/coinbase-exchange.service';
// eslint-disable-next-line import/order
import { CoinbaseService } from './coinbase/coinbase.service';
import { ExchangeKey } from './exchange-key/exchange-key.entity';
import { ExchangeKeyModule } from './exchange-key/exchange-key.module';
import { ExchangeManagerService } from './exchange-manager.service';
import { ExchangeController } from './exchange.controller';
import { Exchange } from './exchange.entity';
import { ExchangeService } from './exchange.service';
import { EXCHANGE_MANAGER_SERVICE, EXCHANGE_SERVICE } from './interfaces';
import { KrakenService } from './kraken/kraken.service';
import { ExchangeSyncTask } from './tasks/exchange-sync.task';

import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';
import { TickerPairs } from '../coin/ticker-pairs/ticker-pairs.entity';
import { TickerPairService } from '../coin/ticker-pairs/ticker-pairs.service';
import { SharedCacheModule } from '../shared-cache.module';

@Module({
  controllers: [ExchangeController],
  imports: [
    TypeOrmModule.forFeature([Coin, Exchange, ExchangeKey, TickerPairs]),
    forwardRef(() => ExchangeKeyModule),
    SharedCacheModule,
    BullModule.registerQueue({ name: 'exchange-queue' })
  ],
  providers: [
    BinanceUSService,
    CoinbaseService,
    CoinbaseExchangeService,
    KrakenService,
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
    TickerPairService
  ],
  exports: [
    ExchangeService,
    EXCHANGE_SERVICE,
    BinanceUSService,
    CoinbaseService,
    CoinbaseExchangeService,
    KrakenService,
    ExchangeManagerService,
    EXCHANGE_MANAGER_SERVICE
  ]
})
export class ExchangeModule {}
