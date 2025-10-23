import { BullModule } from '@nestjs/bullmq';
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PortfolioController } from './portfolio.controller';
import { Portfolio } from './portfolio.entity';
import { PortfolioService } from './portfolio.service';
import { PortfolioHistoricalPriceTask } from './tasks/portfolio-historical-price.task';

import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';
import { PriceModule } from '../price/price.module';
import { SharedCacheModule } from '../shared-cache.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Portfolio, Coin]),
    BullModule.registerQueue({ name: 'portfolio-queue' }),
    forwardRef(() => PriceModule),
    SharedCacheModule
  ],
  controllers: [PortfolioController],
  providers: [PortfolioService, PortfolioHistoricalPriceTask, CoinService],
  exports: [PortfolioService, PortfolioHistoricalPriceTask]
})
export class PortfolioModule {}
