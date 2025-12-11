import { BullModule } from '@nestjs/bullmq';
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AlgorithmActivation } from './algorithm-activation.entity';
import { AlgorithmPerformanceController } from './algorithm-performance.controller';
import { AlgorithmPerformance } from './algorithm-performance.entity';
import { AlgorithmController } from './algorithm.controller';
import { Algorithm } from './algorithm.entity';
import { AlgorithmService } from './algorithm.service';
import { AlgorithmRegistry } from './registry/algorithm-registry.service';
import { AlgorithmActivationService } from './services/algorithm-activation.service';
import { AlgorithmContextBuilder } from './services/algorithm-context-builder.service';
import { AlgorithmPerformanceService } from './services/algorithm-performance.service';
import { ExponentialMovingAverageStrategy } from './strategies/exponential-moving-average.strategy';
import { MeanReversionStrategy } from './strategies/mean-reversion.strategy';
import { SimpleMovingAverageCrossoverStrategy } from './strategies/simple-moving-average-crossover.strategy';
import { PerformanceRankingTask } from './tasks/performance-ranking.task';

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
import { SharedCacheModule } from '../shared-cache.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    forwardRef(() => AppModule),
    TypeOrmModule.forFeature([Algorithm, AlgorithmActivation, AlgorithmPerformance, Coin, Order, Price, TickerPairs]),
    BullModule.registerQueue({ name: 'performance-ranking' }),
    SharedCacheModule,
    forwardRef(() => ExchangeModule),
    forwardRef(() => ExchangeKeyModule),
    forwardRef(() => OrderModule),
    forwardRef(() => UsersModule),
    forwardRef(() => PortfolioModule)
  ],
  controllers: [AlgorithmController, AlgorithmPerformanceController],
  providers: [
    AlgorithmService,
    AlgorithmActivationService,
    AlgorithmPerformanceService,
    AlgorithmRegistry,
    AlgorithmContextBuilder,
    CoinService,
    PriceService,
    TickerPairService,
    ExponentialMovingAverageStrategy,
    MeanReversionStrategy,
    SimpleMovingAverageCrossoverStrategy,
    PerformanceRankingTask,

    // Strategy registration factory
    {
      provide: 'ALGORITHM_STRATEGIES_INIT',
      useFactory: async (
        emaStrategy: ExponentialMovingAverageStrategy,
        meanReversionStrategy: MeanReversionStrategy,
        smaCrossoverStrategy: SimpleMovingAverageCrossoverStrategy,
        registry: AlgorithmRegistry
      ) => {
        registry.registerStrategy(emaStrategy);
        registry.registerStrategy(meanReversionStrategy);
        registry.registerStrategy(smaCrossoverStrategy);

        return [emaStrategy, meanReversionStrategy, smaCrossoverStrategy];
      },
      inject: [
        ExponentialMovingAverageStrategy,
        MeanReversionStrategy,
        SimpleMovingAverageCrossoverStrategy,
        AlgorithmRegistry
      ]
    }
  ],
  exports: [
    AlgorithmService,
    AlgorithmActivationService,
    AlgorithmPerformanceService,
    AlgorithmRegistry,
    AlgorithmContextBuilder
  ]
})
export class AlgorithmModule {}
