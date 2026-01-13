import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ExchangeSymbolMap } from './exchange-symbol-map.entity';
import { OHLCCandle } from './ohlc-candle.entity';
import { OHLCController } from './ohlc.controller';
import { OHLCService } from './ohlc.service';
import { ExchangeOHLCService } from './services/exchange-ohlc.service';
import { OHLCBackfillService } from './services/ohlc-backfill.service';
import { RealtimeTickerService } from './services/realtime-ticker.service';
import { OHLCPruneTask } from './tasks/ohlc-prune.task';
import { OHLCSyncTask } from './tasks/ohlc-sync.task';

import { CoinModule } from '../coin/coin.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { SharedCacheModule } from '../shared-cache.module';

@Module({
  imports: [
    SharedCacheModule,
    TypeOrmModule.forFeature([OHLCCandle, ExchangeSymbolMap]),
    BullModule.registerQueue({ name: 'ohlc-queue' }),
    forwardRef(() => CoinModule),
    forwardRef(() => ExchangeModule)
  ],
  controllers: [OHLCController],
  providers: [
    OHLCService,
    ExchangeOHLCService,
    OHLCBackfillService,
    RealtimeTickerService,
    OHLCSyncTask,
    OHLCPruneTask
  ],
  exports: [OHLCService, ExchangeOHLCService, OHLCBackfillService, RealtimeTickerService]
})
export class OHLCModule {}
