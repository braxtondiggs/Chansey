import { BullModule } from '@nestjs/bullmq';
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CoinSelectionController } from './coin-selection.controller';
import { CoinSelection } from './coin-selection.entity';
import { CoinSelectionService } from './coin-selection.service';
import { CoinSelectionHistoricalPriceTask } from './tasks/coin-selection-historical-price.task';

import { CoinModule } from '../coin/coin.module';
import { OHLCModule } from '../ohlc/ohlc.module';
import { SharedCacheModule } from '../shared-cache.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CoinSelection]),
    BullModule.registerQueue({ name: 'coin-selection-queue' }),
    forwardRef(() => CoinModule),
    forwardRef(() => OHLCModule),
    SharedCacheModule
  ],
  controllers: [CoinSelectionController],
  providers: [CoinSelectionService, CoinSelectionHistoricalPriceTask],
  exports: [CoinSelectionService, CoinSelectionHistoricalPriceTask]
})
export class CoinSelectionModule {}
