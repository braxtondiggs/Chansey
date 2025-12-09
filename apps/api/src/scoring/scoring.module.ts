import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CalmarRatioCalculator } from './metrics/calmar-ratio.calculator';
import { ProfitFactorCalculator } from './metrics/profit-factor.calculator';
import { StabilityCalculator } from './metrics/stability.calculator';
import { WinRateCalculator } from './metrics/win-rate.calculator';
import { ScoringService } from './scoring.service';
import { DegradationCalculator } from './walk-forward/degradation.calculator';
import { WalkForwardService } from './walk-forward/walk-forward.service';
import { WindowProcessor } from './walk-forward/window-processor';

import { CorrelationCalculator } from '../common/metrics/correlation.calculator';
import { DrawdownCalculator } from '../common/metrics/drawdown.calculator';
import { SharpeRatioCalculator } from '../common/metrics/sharpe-ratio.calculator';
import { StrategyScore } from '../strategy/entities/strategy-score.entity';

@Module({
  imports: [TypeOrmModule.forFeature([StrategyScore])],
  providers: [
    ScoringService,
    WalkForwardService,
    WindowProcessor,
    DegradationCalculator,
    CalmarRatioCalculator,
    WinRateCalculator,
    ProfitFactorCalculator,
    StabilityCalculator,
    SharpeRatioCalculator,
    DrawdownCalculator,
    CorrelationCalculator
  ],
  exports: [ScoringService, WalkForwardService, WindowProcessor, DegradationCalculator]
})
export class ScoringModule {}
