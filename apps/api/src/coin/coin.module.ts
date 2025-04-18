import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Exchange } from './../exchange/exchange.entity';
import { ExchangeService } from './../exchange/exchange.service';
import { CoinController } from './coin.controller';
import { Coin } from './coin.entity';
import { CoinService } from './coin.service';
import { CoinTask } from './coin.task';
import { TickerPairs } from './ticker-pairs/ticker-pairs.entity';
import { TickerPairService } from './ticker-pairs/ticker-pairs.service';
import { TickerPairTask } from './ticker-pairs/ticker-pairs.task';

import { AppModule } from '../app.module';
import { BinanceService } from '../exchange/binance/binance.service';
import { Portfolio } from '../portfolio/portfolio.entity';
import { PortfolioService } from '../portfolio/portfolio.service';
import { HealthCheckHelper } from '../utils/health-check.helper';

@Module({
  controllers: [CoinController],
  exports: [CoinService, TickerPairService, TickerPairTask],
  imports: [forwardRef(() => AppModule), TypeOrmModule.forFeature([Coin, Exchange, Portfolio, TickerPairs])],
  providers: [
    BinanceService,
    CoinService,
    CoinTask,
    ExchangeService,
    HealthCheckHelper,
    PortfolioService,
    TickerPairService,
    TickerPairTask
  ]
})
export class CoinModule {}
