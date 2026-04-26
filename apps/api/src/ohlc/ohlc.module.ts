import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ExchangeSymbolMap } from './exchange-symbol-map.entity';
import { OHLCCandle } from './ohlc-candle.entity';
import { OHLCController } from './ohlc.controller';
import { OHLCService } from './ohlc.service';
import { ExchangeOHLCService } from './services/exchange-ohlc.service';
import { ExchangeSymbolMapService } from './services/exchange-symbol-map.service';
import { OHLCBackfillService } from './services/ohlc-backfill.service';
import { RealtimeTickerService } from './services/realtime-ticker.service';
import { OHLCBackfillJobTask } from './tasks/ohlc-backfill-job.task';
import { OHLCGapDetectionTask } from './tasks/ohlc-gap-detection.task';
import { OHLCPruneTask } from './tasks/ohlc-prune.task';
import { OHLCSyncTask } from './tasks/ohlc-sync.task';

import { CoinModule } from '../coin/coin.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { SharedCacheModule } from '../shared-cache.module';

@Module({
  imports: [
    SharedCacheModule,
    TypeOrmModule.forFeature([OHLCCandle, ExchangeSymbolMap]),
    BullModule.registerQueue({ name: 'ohlc-sync-queue' }),
    BullModule.registerQueue({ name: 'ohlc-prune-queue' }),
    BullModule.registerQueue({ name: 'ohlc-gap-detection-queue' }),
    BullModule.registerQueue({ name: 'ohlc-backfill-queue' }),
    forwardRef(() => CoinModule),
    forwardRef(() => ExchangeModule)
  ],
  controllers: [OHLCController],
  providers: [
    OHLCService,
    ExchangeOHLCService,
    ExchangeSymbolMapService,
    OHLCBackfillService,
    RealtimeTickerService,
    OHLCSyncTask,
    OHLCPruneTask,
    OHLCGapDetectionTask,
    OHLCBackfillJobTask
  ],
  exports: [OHLCService, ExchangeOHLCService, ExchangeSymbolMapService, OHLCBackfillService, RealtimeTickerService]
})
export class OHLCModule {}
