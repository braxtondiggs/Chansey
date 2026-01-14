import { BullModule } from '@nestjs/bullmq';
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AlgorithmActivation } from './algorithm-activation.entity';
import { AlgorithmPerformanceController } from './algorithm-performance.controller';
import { AlgorithmPerformance } from './algorithm-performance.entity';
import { AlgorithmController } from './algorithm.controller';
import { Algorithm } from './algorithm.entity';
import { AlgorithmService } from './algorithm.service';
import { IndicatorModule } from './indicators';
import { AlgorithmRegistry } from './registry/algorithm-registry.service';
import { AlgorithmActivationService } from './services/algorithm-activation.service';
import { AlgorithmContextBuilder } from './services/algorithm-context-builder.service';
import { AlgorithmPerformanceService } from './services/algorithm-performance.service';
import { ATRTrailingStopStrategy } from './strategies/atr-trailing-stop.strategy';
import { BollingerBandSqueezeStrategy } from './strategies/bollinger-band-squeeze.strategy';
import { BollingerBandsBreakoutStrategy } from './strategies/bollinger-bands-breakout.strategy';
import { ConfluenceStrategy } from './strategies/confluence.strategy';
import { EMARSIFilterStrategy } from './strategies/ema-rsi-filter.strategy';
import { ExponentialMovingAverageStrategy } from './strategies/exponential-moving-average.strategy';
import { MACDStrategy } from './strategies/macd.strategy';
import { MeanReversionStrategy } from './strategies/mean-reversion.strategy';
import { RSIDivergenceStrategy } from './strategies/rsi-divergence.strategy';
import { RSIMACDComboStrategy } from './strategies/rsi-macd-combo.strategy';
import { RSIStrategy } from './strategies/rsi.strategy';
import { SimpleMovingAverageCrossoverStrategy } from './strategies/simple-moving-average-crossover.strategy';
import { TripleEMAStrategy } from './strategies/triple-ema.strategy';
import { PerformanceRankingTask } from './tasks/performance-ranking.task';

import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';
import { TickerPairs } from '../coin/ticker-pairs/ticker-pairs.entity';
import { TickerPairService } from '../coin/ticker-pairs/ticker-pairs.service';
import { ExchangeKeyModule } from '../exchange/exchange-key/exchange-key.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { OHLCModule } from '../ohlc/ohlc.module';
import { Order } from '../order/order.entity';
import { OrderModule } from '../order/order.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { SharedCacheModule } from '../shared-cache.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Algorithm, AlgorithmActivation, AlgorithmPerformance, Coin, Order, TickerPairs]),
    BullModule.registerQueue({ name: 'performance-ranking' }),
    SharedCacheModule,
    IndicatorModule,
    forwardRef(() => ExchangeModule),
    forwardRef(() => ExchangeKeyModule),
    forwardRef(() => OrderModule),
    forwardRef(() => UsersModule),
    forwardRef(() => PortfolioModule),
    forwardRef(() => OHLCModule)
  ],
  controllers: [AlgorithmController, AlgorithmPerformanceController],
  providers: [
    AlgorithmService,
    AlgorithmActivationService,
    AlgorithmPerformanceService,
    AlgorithmRegistry,
    AlgorithmContextBuilder,
    CoinService,
    TickerPairService,
    ExponentialMovingAverageStrategy,
    MeanReversionStrategy,
    SimpleMovingAverageCrossoverStrategy,
    RSIStrategy,
    MACDStrategy,
    BollingerBandsBreakoutStrategy,
    RSIMACDComboStrategy,
    ATRTrailingStopStrategy,
    RSIDivergenceStrategy,
    BollingerBandSqueezeStrategy,
    TripleEMAStrategy,
    EMARSIFilterStrategy,
    ConfluenceStrategy,
    PerformanceRankingTask,

    // Strategy registration factory
    {
      provide: 'ALGORITHM_STRATEGIES_INIT',
      useFactory: async (
        emaStrategy: ExponentialMovingAverageStrategy,
        meanReversionStrategy: MeanReversionStrategy,
        smaCrossoverStrategy: SimpleMovingAverageCrossoverStrategy,
        rsiStrategy: RSIStrategy,
        macdStrategy: MACDStrategy,
        bbBreakoutStrategy: BollingerBandsBreakoutStrategy,
        rsiMacdComboStrategy: RSIMACDComboStrategy,
        atrTrailingStopStrategy: ATRTrailingStopStrategy,
        rsiDivergenceStrategy: RSIDivergenceStrategy,
        bbSqueezeStrategy: BollingerBandSqueezeStrategy,
        tripleEmaStrategy: TripleEMAStrategy,
        emaRsiFilterStrategy: EMARSIFilterStrategy,
        confluenceStrategy: ConfluenceStrategy,
        registry: AlgorithmRegistry
      ) => {
        registry.registerStrategy(emaStrategy);
        registry.registerStrategy(meanReversionStrategy);
        registry.registerStrategy(smaCrossoverStrategy);
        registry.registerStrategy(rsiStrategy);
        registry.registerStrategy(macdStrategy);
        registry.registerStrategy(bbBreakoutStrategy);
        registry.registerStrategy(rsiMacdComboStrategy);
        registry.registerStrategy(atrTrailingStopStrategy);
        registry.registerStrategy(rsiDivergenceStrategy);
        registry.registerStrategy(bbSqueezeStrategy);
        registry.registerStrategy(tripleEmaStrategy);
        registry.registerStrategy(emaRsiFilterStrategy);
        registry.registerStrategy(confluenceStrategy);

        return [
          emaStrategy,
          meanReversionStrategy,
          smaCrossoverStrategy,
          rsiStrategy,
          macdStrategy,
          bbBreakoutStrategy,
          rsiMacdComboStrategy,
          atrTrailingStopStrategy,
          rsiDivergenceStrategy,
          bbSqueezeStrategy,
          tripleEmaStrategy,
          emaRsiFilterStrategy,
          confluenceStrategy
        ];
      },
      inject: [
        ExponentialMovingAverageStrategy,
        MeanReversionStrategy,
        SimpleMovingAverageCrossoverStrategy,
        RSIStrategy,
        MACDStrategy,
        BollingerBandsBreakoutStrategy,
        RSIMACDComboStrategy,
        ATRTrailingStopStrategy,
        RSIDivergenceStrategy,
        BollingerBandSqueezeStrategy,
        TripleEMAStrategy,
        EMARSIFilterStrategy,
        ConfluenceStrategy,
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
