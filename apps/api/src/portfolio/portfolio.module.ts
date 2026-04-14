import { Module, forwardRef } from '@nestjs/common';

import { PortfolioAggregationService } from './portfolio-aggregation.service';
import { PortfolioCacheListener } from './portfolio-cache.listener';
import { PortfolioController } from './portfolio.controller';

import { CoinModule } from '../coin/coin.module';
import { OHLCModule } from '../ohlc/ohlc.module';
import { SharedCacheModule } from '../shared-cache.module';
import { StrategyModule } from '../strategy/strategy.module';

@Module({
  imports: [
    forwardRef(() => CoinModule),
    forwardRef(() => OHLCModule),
    forwardRef(() => StrategyModule),
    SharedCacheModule
  ],
  controllers: [PortfolioController],
  providers: [PortfolioAggregationService, PortfolioCacheListener],
  exports: [PortfolioAggregationService]
})
export class PortfolioModule {}
