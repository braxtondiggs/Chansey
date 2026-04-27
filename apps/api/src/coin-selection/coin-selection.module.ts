import { BullModule } from '@nestjs/bullmq';
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CoinSelectionController } from './coin-selection.controller';
import { CoinSelection } from './coin-selection.entity';
import { CoinSelectionService } from './coin-selection.service';
import { CoinSelectionHistoricalPriceTask } from './tasks/coin-selection-historical-price.task';

import { ActivePositionGuardModule } from '../active-position-guard';
import { CoinModule } from '../coin/coin.module';
import { ExchangeKeyModule } from '../exchange/exchange-key/exchange-key.module';
import { OHLCModule } from '../ohlc/ohlc.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CoinSelection]),
    BullModule.registerQueue({ name: 'coin-selection-queue' }),
    ActivePositionGuardModule,
    forwardRef(() => CoinModule),
    forwardRef(() => ExchangeKeyModule),
    forwardRef(() => OHLCModule)
  ],
  controllers: [CoinSelectionController],
  providers: [CoinSelectionService, CoinSelectionHistoricalPriceTask],
  exports: [CoinSelectionService, CoinSelectionHistoricalPriceTask]
})
export class CoinSelectionModule {}
