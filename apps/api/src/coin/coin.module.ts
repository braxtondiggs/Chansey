import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CoinController } from './coin.controller';
import { Coin } from './coin.entity';
import { CoinService } from './coin.service';
import { CoinTask } from './coin.task';
import { TickerPairs } from './ticker-pairs/ticker-pairs.entity';
import { TickerPairService } from './ticker-pairs/ticker-pairs.service';
import { TickerPairTask } from './ticker-pairs/ticker-pairs.task';

import { AppModule } from '../app.module';
import { ExchangeKeyModule } from '../exchange/exchange-key/exchange-key.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { Portfolio } from '../portfolio/portfolio.entity';
import { PortfolioService } from '../portfolio/portfolio.service';
import { HealthCheckHelper } from '../utils/health-check.helper';

@Module({
  controllers: [CoinController],
  exports: [CoinService, TickerPairService, TickerPairTask],
  imports: [
    forwardRef(() => AppModule),
    TypeOrmModule.forFeature([Coin, Portfolio, TickerPairs]),
    forwardRef(() => ExchangeModule),
    forwardRef(() => ExchangeKeyModule),
    forwardRef(() => import('../price/price.module').then((m) => m.PriceModule))
  ],
  providers: [CoinService, CoinTask, HealthCheckHelper, PortfolioService, TickerPairService, TickerPairTask]
})
export class CoinModule {}
