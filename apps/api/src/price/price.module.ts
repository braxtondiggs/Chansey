import { BullModule } from '@nestjs/bullmq';
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Coin } from '@chansey-api/coin/coin.entity';
import { CoinService } from '@chansey-api/coin/coin.service';

import { PriceController } from './price.controller';
import { Price } from './price.entity';
import { PriceService } from './price.service';
import { PriceSyncTask } from './tasks/price-sync.task';

import { PortfolioModule } from '../portfolio/portfolio.module';
import { SharedCacheModule } from '../shared-cache.module';

@Module({
  imports: [
    SharedCacheModule,
    TypeOrmModule.forFeature([Coin, Price]),
    BullModule.registerQueue({ name: 'price-queue' }),
    forwardRef(() => PortfolioModule)
  ],
  controllers: [PriceController],
  providers: [CoinService, PriceService, PriceSyncTask],
  exports: [PriceService, PriceSyncTask]
})
export class PriceModule {}
