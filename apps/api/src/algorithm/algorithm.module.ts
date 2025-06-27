import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AlgorithmController } from './algorithm.controller';
import { Algorithm } from './algorithm.entity';
import { AlgorithmService } from './algorithm.service';
import { AlgorithmRegistry } from './registry/algorithm-registry.service';
import { AlgorithmContextBuilder } from './services/algorithm-context-builder.service';
import { ExponentialMovingAverageStrategy } from './strategies/exponential-moving-average.strategy';
import { MeanReversionStrategy } from './strategies/mean-reversion.strategy';

import { AppModule } from '../app.module';
import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';
import { TickerPairs } from '../coin/ticker-pairs/ticker-pairs.entity';
import { TickerPairService } from '../coin/ticker-pairs/ticker-pairs.service';
import { ExchangeKeyModule } from '../exchange/exchange-key/exchange-key.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { Order } from '../order/order.entity';
import { OrderModule } from '../order/order.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { Price } from '../price/price.entity';
import { PriceService } from '../price/price.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    forwardRef(() => AppModule),
    TypeOrmModule.forFeature([Algorithm, Coin, Order, Price, TickerPairs]),
    forwardRef(() => ExchangeModule),
    forwardRef(() => ExchangeKeyModule),
    forwardRef(() => OrderModule),
    forwardRef(() => UsersModule),
    forwardRef(() => PortfolioModule)
  ],
  controllers: [AlgorithmController],
  providers: [
    AlgorithmService,
    AlgorithmRegistry,
    AlgorithmContextBuilder,
    CoinService,
    PriceService,
    TickerPairService,
    ExponentialMovingAverageStrategy,
    MeanReversionStrategy,

    // Strategy registration factory
    {
      provide: 'ALGORITHM_STRATEGIES_INIT',
      useFactory: async (
        emaStrategy: ExponentialMovingAverageStrategy,
        meanReversionStrategy: MeanReversionStrategy,
        registry: AlgorithmRegistry
      ) => {
        registry.registerStrategy(emaStrategy);
        registry.registerStrategy(meanReversionStrategy);

        return [emaStrategy, meanReversionStrategy];
      },
      inject: [ExponentialMovingAverageStrategy, MeanReversionStrategy, AlgorithmRegistry]
    }
  ],
  exports: [AlgorithmService, AlgorithmRegistry, AlgorithmContextBuilder]
})
export class AlgorithmModule {}
