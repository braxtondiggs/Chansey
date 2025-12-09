import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MarketRegime } from './entities/market-regime.entity';
import { MarketRegimeController } from './market-regime.controller';
import { MarketRegimeService } from './market-regime.service';
import { RegimeChangeDetector } from './regime-change.detector';
import { VolatilityCalculator } from './volatility.calculator';

@Module({
  imports: [TypeOrmModule.forFeature([MarketRegime])],
  providers: [MarketRegimeService, VolatilityCalculator, RegimeChangeDetector],
  controllers: [MarketRegimeController],
  exports: [MarketRegimeService, VolatilityCalculator, RegimeChangeDetector]
})
export class MarketRegimeModule {}
