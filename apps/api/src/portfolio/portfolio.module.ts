import { BullModule } from '@nestjs/bullmq';
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PortfolioAggregationService } from './portfolio-aggregation.service';
import { PortfolioController } from './portfolio.controller';
import { Portfolio } from './portfolio.entity';
import { PortfolioService } from './portfolio.service';
import { PortfolioHistoricalPriceTask } from './tasks/portfolio-historical-price.task';

import { CoinModule } from '../coin/coin.module';
import { OHLCModule } from '../ohlc/ohlc.module';
import { SharedCacheModule } from '../shared-cache.module';
import { StrategyModule } from '../strategy/strategy.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Portfolio]),
    BullModule.registerQueue({ name: 'portfolio-queue' }),
    forwardRef(() => CoinModule),
    forwardRef(() => OHLCModule),
    forwardRef(() => StrategyModule),
    SharedCacheModule
  ],
  controllers: [PortfolioController],
  providers: [PortfolioService, PortfolioAggregationService, PortfolioHistoricalPriceTask],
  exports: [PortfolioService, PortfolioAggregationService, PortfolioHistoricalPriceTask]
})
export class PortfolioModule {}
