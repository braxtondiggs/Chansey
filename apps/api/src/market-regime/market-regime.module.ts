import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CompositeRegimeService } from './composite-regime.service';
import { MarketRegime } from './entities/market-regime.entity';
import { MarketRegimeController } from './market-regime.controller';
import { MarketRegimeService } from './market-regime.service';
import { RegimeChangeDetector } from './regime-change.detector';
import { RegimeGateService } from './regime-gate.service';
import { VolatilityCalculator } from './volatility.calculator';

import { AuditModule } from '../audit/audit.module';
import { CoinModule } from '../coin/coin.module';
import { SharedCacheModule } from '../shared-cache.module';
import { Deployment } from '../strategy/entities/deployment.entity';
import { StrategyConfig } from '../strategy/entities/strategy-config.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([MarketRegime, StrategyConfig, Deployment]),
    forwardRef(() => CoinModule),
    AuditModule,
    SharedCacheModule
  ],
  providers: [
    MarketRegimeService,
    VolatilityCalculator,
    RegimeChangeDetector,
    CompositeRegimeService,
    RegimeGateService
  ],
  controllers: [MarketRegimeController],
  exports: [MarketRegimeService, VolatilityCalculator, RegimeChangeDetector, CompositeRegimeService, RegimeGateService]
})
export class MarketRegimeModule {}
