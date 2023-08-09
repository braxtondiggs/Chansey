import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AlgorithmController } from './algorithm.controller';
import { Algorithm } from './algorithm.entity';
import { AlgorithmService } from './algorithm.service';
import * as DynamicAlgorithmServices from './scripts';
import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';
import { Ticker } from '../exchange/ticker/ticker.entity';
import { TickerService } from '../exchange/ticker/ticker.service';
import { Order } from '../order/order.entity';
import { OrderService } from '../order/order.service';
import { Testnet } from '../order/testnet/testnet.entity';
import { TestnetService } from '../order/testnet/testnet.service';
import { Portfolio } from '../portfolio/portfolio.entity';
import { PortfolioService } from '../portfolio/portfolio.service';
import { Price } from '../price/price.entity';
import { PriceService } from '../price/price.service';
import { User } from '../users/users.entity';
import UsersService from '../users/users.service';

@Module({
  imports: [TypeOrmModule.forFeature([Algorithm, Coin, Order, Ticker, Testnet, Portfolio, Price, User])],
  controllers: [AlgorithmController],
  providers: [
    AlgorithmService,
    CoinService,
    ConfigService,
    OrderService,
    PortfolioService,
    PriceService,
    TestnetService,
    TickerService,
    UsersService,
    ...Object.values(DynamicAlgorithmServices)
  ]
})
export class AlgorithmModule implements OnApplicationBootstrap {
  constructor(private readonly algorithm: AlgorithmService, private readonly moduleRef: ModuleRef) {}

  async onApplicationBootstrap() {
    const algorithms = await this.algorithm.getAlgorithmsForTesting();
    for (const cls of Object.values(DynamicAlgorithmServices)) {
      const provider = this.moduleRef.get(cls, { strict: false });
      const algorithm = algorithms.find((algorithm) => algorithm.id === provider.id && algorithm.status);
      if (provider && algorithm) await provider.onInit(algorithm);
    }
  }
}
