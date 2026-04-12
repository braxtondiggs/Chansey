import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdminPoolController } from './admin-pool.controller';
import { CapitalAllocationService } from './capital-allocation.service';
import { ConcentrationGateService } from './concentration-gate.service';
import { DailyLossLimitGateService } from './daily-loss-limit-gate.service';
import { DeploymentMetricsService } from './deployment-metrics.service';
import { DeploymentController } from './deployment.controller';
import { DeploymentService } from './deployment.service';
import { BacktestRun } from './entities/backtest-run.entity';
import { Deployment } from './entities/deployment.entity';
import { LiveTradingSignal } from './entities/live-trading-signal.entity';
import { PerformanceMetric } from './entities/performance-metric.entity';
import { StrategyConfig } from './entities/strategy-config.entity';
import { StrategyScore } from './entities/strategy-score.entity';
import { UserStrategyPosition } from './entities/user-strategy-position.entity';
import { WalkForwardWindow } from './entities/walk-forward-window.entity';
import { CorrelationLimitGate } from './gates/correlation-limit.gate';
import { MaximumDrawdownGate } from './gates/maximum-drawdown.gate';
import { MinimumScoreGate } from './gates/minimum-score.gate';
import { MinimumTradesGate } from './gates/minimum-trades.gate';
import { PortfolioCapacityGate } from './gates/portfolio-capacity.gate';
import { PositiveReturnsGate } from './gates/positive-returns.gate';
import { PromotionGateService } from './gates/promotion-gate.service';
import { VolatilityCapGate } from './gates/volatility-cap.gate';
import { WFAConsistencyGate } from './gates/wfa-consistency.gate';
import { LiveSignalService } from './live-signal.service';
import { LiveTradingService } from './live-trading.service';
import { OpportunitySellingExecutionService } from './opportunity-selling-execution.service';
import { OrderPlacementService } from './order-placement.service';
import { PerformanceCalculationService } from './performance-calculation.service';
import { PoolStatisticsService } from './pool-statistics.service';
import { PositionTrackingService } from './position-tracking.service';
import { PreTradeRiskGateService } from './pre-trade-risk-gate.service';
import { ConcentrationCheckService } from './risk/concentration-check.service';
import { ConcentrationRiskCheck } from './risk/concentration-risk.check';
import { ConsecutiveLossesCheck } from './risk/consecutive-losses.check';
import { DailyLossLimitCheck } from './risk/daily-loss-limit.check';
import { DrawdownBreachCheck } from './risk/drawdown-breach.check';
import { RiskManagementService } from './risk/risk-management.service';
import { SharpeDegradationCheck } from './risk/sharpe-degradation.check';
import { VolatilitySpikeCheck } from './risk/volatility-spike.check';
import { RiskPoolMappingService } from './risk-pool-mapping.service';
import { EntryGateService } from './services/entry-gate.service';
import { StrategyExecutorService } from './strategy-executor.service';
import { StrategyController } from './strategy.controller';
import { StrategyService } from './strategy.service';
import { LiveSignalCleanupTask } from './tasks/live-signal-cleanup.task';
import { UserPerformanceService } from './user-performance.service';

import { AdminModule } from '../admin/admin.module';
import { AlgorithmModule } from '../algorithm/algorithm.module';
import { AuditModule } from '../audit/audit.module';
import { BalanceModule } from '../balance/balance.module';
import { DrawdownCalculator } from '../common/metrics/drawdown.calculator';
import { SharpeRatioCalculator } from '../common/metrics/sharpe-ratio.calculator';
import { ExchangeSelectionModule } from '../exchange/exchange-selection/exchange-selection.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { MarketRegimeModule } from '../market-regime/market-regime.module';
import { MetricsModule } from '../metrics/metrics.module';
import { SignalThrottleService } from '../order/backtest/shared/throttle';
import { Order } from '../order/order.entity';
import { OrderModule } from '../order/order.module';
import { Risk } from '../risk/risk.entity';
import { TasksModule } from '../tasks/tasks.module';
import { User } from '../users/users.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      StrategyConfig,
      LiveTradingSignal,
      BacktestRun,
      WalkForwardWindow,
      StrategyScore,
      Deployment,
      PerformanceMetric,
      UserStrategyPosition,
      Risk,
      User,
      Order
    ]),
    forwardRef(() => AdminModule),
    forwardRef(() => AlgorithmModule),
    AuditModule,
    forwardRef(() => BalanceModule),
    forwardRef(() => ExchangeModule),
    ExchangeSelectionModule,
    forwardRef(() => MarketRegimeModule),
    MetricsModule,
    forwardRef(() => OrderModule),
    forwardRef(() => TasksModule)
  ],
  providers: [
    StrategyService,
    DeploymentMetricsService,
    DeploymentService,
    RiskPoolMappingService,
    PositionTrackingService,
    CapitalAllocationService,
    StrategyExecutorService,
    SignalThrottleService,
    LiveTradingService,
    LiveSignalService,
    OrderPlacementService,
    OpportunitySellingExecutionService,
    PreTradeRiskGateService,
    DailyLossLimitGateService,
    ConcentrationCheckService,
    ConcentrationGateService,
    ConcentrationRiskCheck,
    UserPerformanceService,
    PoolStatisticsService,
    PromotionGateService,
    MinimumScoreGate,
    MinimumTradesGate,
    MaximumDrawdownGate,
    WFAConsistencyGate,
    PositiveReturnsGate,
    CorrelationLimitGate,
    VolatilityCapGate,
    PortfolioCapacityGate,
    RiskManagementService,
    DrawdownBreachCheck,
    DailyLossLimitCheck,
    ConsecutiveLossesCheck,
    VolatilitySpikeCheck,
    SharpeDegradationCheck,
    LiveSignalCleanupTask,
    EntryGateService,
    PerformanceCalculationService,
    SharpeRatioCalculator,
    DrawdownCalculator
  ],
  controllers: [StrategyController, DeploymentController, AdminPoolController],
  exports: [
    StrategyService,
    DeploymentService,
    PromotionGateService,
    RiskManagementService,
    RiskPoolMappingService,
    PositionTrackingService,
    CapitalAllocationService,
    StrategyExecutorService,
    LiveSignalService,
    UserPerformanceService,
    DailyLossLimitGateService,
    ConcentrationGateService,
    EntryGateService,
    PerformanceCalculationService
  ]
})
export class StrategyModule {}
