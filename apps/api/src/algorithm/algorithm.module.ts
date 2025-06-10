import { Module, OnApplicationBootstrap, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OrderModule } from '@chansey-api/order/order.module';

import { TickerPairs } from './../coin/ticker-pairs/ticker-pairs.entity';
import { AlgorithmController } from './algorithm.controller';
import { Algorithm } from './algorithm.entity';
import { AlgorithmService } from './algorithm.service';
import * as DynamicAlgorithmServices from './scripts';

import { AppModule } from '../app.module';
import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';
import { TickerPairService } from '../coin/ticker-pairs/ticker-pairs.service';
import { ExchangeKeyModule } from '../exchange/exchange-key/exchange-key.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { Order } from '../order/order.entity';
import { Testnet } from '../order/testnet/testnet.entity';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { Price } from '../price/price.entity';
import { PriceService } from '../price/price.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    forwardRef(() => AppModule),
    TypeOrmModule.forFeature([Algorithm, Coin, Order, Testnet, Price, TickerPairs]),
    forwardRef(() => ExchangeModule),
    forwardRef(() => ExchangeKeyModule),
    forwardRef(() => OrderModule),
    forwardRef(() => UsersModule),
    forwardRef(() => PortfolioModule)
  ],
  controllers: [AlgorithmController],
  providers: [
    AlgorithmService,
    CoinService,
    ConfigService,
    PriceService,
    TickerPairService,
    ...Object.values(DynamicAlgorithmServices),
    ...Object.values(DynamicAlgorithmServices).map((cls) => ({
      provide: cls.name.toString(),
      useClass: cls
    }))
  ]
})
export class AlgorithmModule implements OnApplicationBootstrap {
  constructor(
    private readonly algorithm: AlgorithmService,
    private readonly moduleRef: ModuleRef
  ) {}

  async onApplicationBootstrap() {
    const algorithms = await this.algorithm.getAlgorithmsForTesting();
    for (const cls of Object.values(DynamicAlgorithmServices)) {
      const provider = this.moduleRef.get(cls, { strict: false });
      const algorithm = algorithms.find((algorithm) => algorithm.id === provider?.id && algorithm.status);
      if (provider && algorithm) await provider.onInit?.(algorithm);
    }
  }
}
