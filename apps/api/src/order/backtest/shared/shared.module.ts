import { forwardRef, Module } from '@nestjs/common';

import { CheckpointService } from './checkpoint';
import {
  BacktestBarProcessor,
  BacktestSignalTradeService,
  BarCheckpointCoordinator,
  ForcedExitService,
  TradeExecutorService
} from './execution';
import { ExitSignalProcessorService } from './exit-signals';
import { FeeCalculatorService } from './fees';
import { SignalFilterChainService } from './filters';
import { MetricsCalculatorService } from './metrics';
import { MetricsAccumulatorService } from './metrics-accumulator';
import { OpportunitySellService } from './opportunity-selling';
import { PortfolioStateService } from './portfolio';
import { PositionManagerService } from './positions';
import { MultiTimeframeAggregatorService, PriceWindowService } from './price-window';
import { CompositeRegimeService } from './regime';
import { SlippageService } from './slippage';
import { SlippageContextService } from './slippage-context';
import { SignalThrottleService } from './throttle';

import { AlgorithmModule } from '../../../algorithm/algorithm.module';
import { DrawdownCalculator } from '../../../common/metrics/drawdown.calculator';
import { SharpeRatioCalculator } from '../../../common/metrics/sharpe-ratio.calculator';
import { RegimeGateService } from '../../../market-regime/regime-gate.service';
import { VolatilityCalculator } from '../../../market-regime/volatility.calculator';
import { PositionAnalysisService } from '../../services/position-analysis.service';

/**
 * Shared Backtest Components Module
 *
 * Provides all shared backtest services for execution across all BacktestTypes:
 * HISTORICAL, LIVE_REPLAY, PAPER_TRADING, STRATEGY_OPTIMIZATION.
 * See the providers array for the full list.
 */
@Module({
  imports: [forwardRef(() => AlgorithmModule)],
  providers: [
    SlippageService,
    FeeCalculatorService,
    PositionManagerService,
    MetricsCalculatorService,
    MetricsAccumulatorService,
    CheckpointService,
    PortfolioStateService,
    SignalThrottleService,
    SignalFilterChainService,
    PositionAnalysisService,
    PriceWindowService,
    MultiTimeframeAggregatorService,
    CompositeRegimeService,
    SlippageContextService,
    ExitSignalProcessorService,
    ForcedExitService,
    TradeExecutorService,
    OpportunitySellService,
    BacktestBarProcessor,
    BacktestSignalTradeService,
    BarCheckpointCoordinator,
    RegimeGateService,
    VolatilityCalculator,
    SharpeRatioCalculator,
    DrawdownCalculator
  ],
  exports: [
    SlippageService,
    FeeCalculatorService,
    PositionManagerService,
    MetricsCalculatorService,
    MetricsAccumulatorService,
    CheckpointService,
    PortfolioStateService,
    SignalThrottleService,
    SignalFilterChainService,
    PositionAnalysisService,
    PriceWindowService,
    MultiTimeframeAggregatorService,
    CompositeRegimeService,
    SlippageContextService,
    ExitSignalProcessorService,
    ForcedExitService,
    TradeExecutorService,
    OpportunitySellService,
    BacktestBarProcessor,
    BacktestSignalTradeService,
    BarCheckpointCoordinator,
    RegimeGateService,
    VolatilityCalculator,
    SharpeRatioCalculator,
    DrawdownCalculator
  ]
})
export class BacktestSharedModule {}
