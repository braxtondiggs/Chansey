import { BullModule } from '@nestjs/bullmq';
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PortfolioAggregationService } from './portfolio-aggregation.service';
import { PortfolioController } from './portfolio.controller';
import { Portfolio } from './portfolio.entity';
import { PortfolioService } from './portfolio.service';
import { PortfolioHistoricalPriceTask } from './tasks/portfolio-historical-price.task';

import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';
import { PriceModule } from '../price/price.module';
import { SharedCacheModule } from '../shared-cache.module';
import { StrategyModule } from '../strategy/strategy.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Portfolio, Coin]),
    BullModule.registerQueue({ name: 'portfolio-queue' }),
    forwardRef(() => PriceModule),
    forwardRef(() => StrategyModule),
    SharedCacheModule
  ],
  controllers: [PortfolioController],
  providers: [PortfolioService, PortfolioAggregationService, PortfolioHistoricalPriceTask, CoinService],
  exports: [PortfolioService, PortfolioAggregationService, PortfolioHistoricalPriceTask]
})
export class PortfolioModule {}
