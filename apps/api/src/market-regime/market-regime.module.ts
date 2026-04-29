import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CompositeRegimeService } from './composite-regime.service';
import { MarketRegime } from './entities/market-regime.entity';
import { MarketRegimeController } from './market-regime.controller';
import { MarketRegimeService } from './market-regime.service';
import { RegimeChangeDetector } from './regime-change.detector';
import { RegimeFitnessService } from './regime-fitness.service';
import { RegimeGateService } from './regime-gate.service';
import { VolatilityCalculator } from './volatility.calculator';

import { AlgorithmModule } from '../algorithm/algorithm.module';
import { AuditModule } from '../audit/audit.module';
import { CoinModule } from '../coin/coin.module';
import { OHLCModule } from '../ohlc/ohlc.module';
import { SharedCacheModule } from '../shared-cache.module';
import { Deployment } from '../strategy/entities/deployment.entity';
import { StrategyConfig } from '../strategy/entities/strategy-config.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([MarketRegime, StrategyConfig, Deployment]),
    forwardRef(() => CoinModule),
    forwardRef(() => OHLCModule),
    forwardRef(() => AlgorithmModule),
    AuditModule,
    SharedCacheModule
  ],
  providers: [
    MarketRegimeService,
    VolatilityCalculator,
    RegimeChangeDetector,
    CompositeRegimeService,
    RegimeGateService,
    RegimeFitnessService
  ],
  controllers: [MarketRegimeController],
  exports: [
    MarketRegimeService,
    VolatilityCalculator,
    RegimeChangeDetector,
    CompositeRegimeService,
    RegimeGateService,
    RegimeFitnessService
  ]
})
export class MarketRegimeModule {}
