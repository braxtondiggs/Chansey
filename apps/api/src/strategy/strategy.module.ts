import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdminPoolController } from './admin-pool.controller';
import { CapitalAllocationService } from './capital-allocation.service';
import { ConcentrationGateService } from './concentration-gate.service';
import { DailyLossLimitGateService } from './daily-loss-limit-gate.service';
import { DeploymentController } from './deployment.controller';
import { DeploymentService } from './deployment.service';
import { BacktestRun } from './entities/backtest-run.entity';
import { Deployment } from './entities/deployment.entity';
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
import { LiveTradingService } from './live-trading.service';
import { PoolStatisticsService } from './pool-statistics.service';
import { PositionTrackingService } from './position-tracking.service';
import { PreTradeRiskGateService } from './pre-trade-risk-gate.service';
// eslint-disable-next-line import/order
import { RiskPoolMappingService } from './risk-pool-mapping.service';
import { ConcentrationCheckService } from './risk/concentration-check.service';
import { ConcentrationRiskCheck } from './risk/concentration-risk.check';
import { ConsecutiveLossesCheck } from './risk/consecutive-losses.check';
import { DailyLossLimitCheck } from './risk/daily-loss-limit.check';
import { DrawdownBreachCheck } from './risk/drawdown-breach.check';
import { RiskManagementService } from './risk/risk-management.service';
import { SharpeDegradationCheck } from './risk/sharpe-degradation.check';
import { VolatilitySpikeCheck } from './risk/volatility-spike.check';
import { StrategyExecutorService } from './strategy-executor.service';
import { StrategyController } from './strategy.controller';
import { StrategyService } from './strategy.service';
import { UserPerformanceService } from './user-performance.service';

import { AdminModule } from '../admin/admin.module';
import { AlgorithmModule } from '../algorithm/algorithm.module';
import { AuditModule } from '../audit/audit.module';
import { BalanceModule } from '../balance/balance.module';
import { ExchangeSelectionModule } from '../exchange/exchange-selection/exchange-selection.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { FailedJobModule } from '../failed-jobs/failed-job.module';
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
    FailedJobModule,
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
    DeploymentService,
    RiskPoolMappingService,
    PositionTrackingService,
    CapitalAllocationService,
    StrategyExecutorService,
    SignalThrottleService,
    LiveTradingService,
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
    SharpeDegradationCheck
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
    UserPerformanceService,
    DailyLossLimitGateService,
    ConcentrationGateService
  ]
})
export class StrategyModule {}
