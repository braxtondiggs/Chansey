import { BullModule } from '@nestjs/bullmq';
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Coin } from '@chansey-api/coin/coin.entity';
import { CoinService } from '@chansey-api/coin/coin.service';

import { Price } from './price.entity';
import { PriceService } from './price.service';
import { PriceSyncTask } from './tasks/price-sync.task';

import { AppModule } from '../app.module';
import { Portfolio } from '../portfolio/portfolio.entity';
import { PortfolioService } from '../portfolio/portfolio.service';

@Module({
  imports: [
    forwardRef(() => AppModule),
    TypeOrmModule.forFeature([Coin, Price, Portfolio]),
    BullModule.registerQueue({ name: 'price-queue' })
  ],
  providers: [CoinService, PriceService, PriceSyncTask, PortfolioService],
  exports: [PriceService, PriceSyncTask]
})
export class PriceModule {}
