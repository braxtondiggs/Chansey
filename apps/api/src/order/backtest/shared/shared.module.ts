import { Module } from '@nestjs/common';

import { FeeCalculatorService } from './fees';
import { MetricsCalculatorService } from './metrics';
import { PortfolioStateService } from './portfolio';
import { PositionManagerService } from './positions';
import { SlippageService } from './slippage';

import { DrawdownCalculator } from '../../../common/metrics/drawdown.calculator';
import { SharpeRatioCalculator } from '../../../common/metrics/sharpe-ratio.calculator';

/**
 * Shared Backtest Components Module
 *
 * Provides reusable services for backtest execution across all BacktestTypes:
 * - HISTORICAL
 * - LIVE_REPLAY
 * - PAPER_TRADING
 * - STRATEGY_OPTIMIZATION
 *
 * Services included:
 * - SlippageService: Configurable slippage simulation
 * - FeeCalculatorService: Fee calculation with flat/maker-taker support
 * - PositionManagerService: Position lifecycle management
 * - MetricsCalculatorService: Performance metrics with proper timeframe awareness
 * - PortfolioStateService: Portfolio state management and checkpointing
 */
@Module({
  providers: [
    // Shared backtest services
    SlippageService,
    FeeCalculatorService,
    PositionManagerService,
    MetricsCalculatorService,
    PortfolioStateService,

    // Dependencies for MetricsCalculatorService
    SharpeRatioCalculator,
    DrawdownCalculator
  ],
  exports: [
    SlippageService,
    FeeCalculatorService,
    PositionManagerService,
    MetricsCalculatorService,
    PortfolioStateService,
    SharpeRatioCalculator,
    DrawdownCalculator
  ]
})
export class BacktestSharedModule {}
