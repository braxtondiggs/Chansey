import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BacktestMonitoringAnalyticsService } from './backtest-monitoring/backtest-monitoring-analytics.service';
import { BacktestMonitoringQueryService } from './backtest-monitoring/backtest-monitoring-query.service';
import { BacktestMonitoringController } from './backtest-monitoring/backtest-monitoring.controller';
import { BacktestMonitoringService } from './backtest-monitoring/backtest-monitoring.service';
import { LiveReplayMonitoringService } from './backtest-monitoring/live-replay-monitoring.service';
import { MonitoringExportService } from './backtest-monitoring/monitoring-export.service';
import { OptimizationAnalyticsService } from './backtest-monitoring/optimization-analytics.service';
import { PaperTradingMonitoringService } from './backtest-monitoring/paper-trading-monitoring.service';
import { SignalActivityFeedService } from './backtest-monitoring/signal-activity-feed.service';
import { SignalAnalyticsService } from './backtest-monitoring/signal-analytics.service';
import { TradeAnalyticsService } from './backtest-monitoring/trade-analytics.service';
import { LiveTradeMonitoringModule } from './live-trade-monitoring/live-trade-monitoring.module';
import { TradingStateController } from './trading-state/trading-state.controller';
import { TradingState } from './trading-state/trading-state.entity';
import { TradingStateService } from './trading-state/trading-state.service';

import { AuditModule } from '../audit/audit.module';
import { Coin } from '../coin/coin.entity';
import { OptimizationResult } from '../optimization/entities/optimization-result.entity';
import { OptimizationRunSummary } from '../optimization/entities/optimization-run-summary.entity';
import { OptimizationRun } from '../optimization/entities/optimization-run.entity';
import { BacktestSignal } from '../order/backtest/backtest-signal.entity';
import { BacktestSummary } from '../order/backtest/backtest-summary.entity';
import { BacktestTrade } from '../order/backtest/backtest-trade.entity';
import { Backtest } from '../order/backtest/backtest.entity';
import { SimulatedOrderFill } from '../order/backtest/simulated-order-fill.entity';
import { Order } from '../order/order.entity';
import { OrderModule } from '../order/order.module';
import { PaperTradingOrder } from '../order/paper-trading/entities/paper-trading-order.entity';
import { PaperTradingSessionSummary } from '../order/paper-trading/entities/paper-trading-session-summary.entity';
import { PaperTradingSession } from '../order/paper-trading/entities/paper-trading-session.entity';
import { PaperTradingSignal } from '../order/paper-trading/entities/paper-trading-signal.entity';
import { LiveTradingSignal } from '../strategy/entities/live-trading-signal.entity';
import { StrategyModule } from '../strategy/strategy.module';
import { TasksModule } from '../tasks/tasks.module';

/**
 * AdminModule
 *
 * Contains admin-only features including:
 * - Global trading kill switch
 * - System status monitoring
 * - Backtest monitoring dashboard
 *
 * All endpoints require admin role authorization.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      TradingState,
      Order,
      Coin,
      Backtest,
      BacktestTrade,
      BacktestSignal,
      BacktestSummary,
      SimulatedOrderFill,
      OptimizationRun,
      OptimizationResult,
      OptimizationRunSummary,
      PaperTradingSession,
      PaperTradingSessionSummary,
      PaperTradingOrder,
      PaperTradingSignal,
      LiveTradingSignal
    ]),
    AuditModule,
    LiveTradeMonitoringModule,
    forwardRef(() => OrderModule),
    forwardRef(() => StrategyModule),
    forwardRef(() => TasksModule)
  ],
  providers: [
    TradingStateService,
    BacktestMonitoringService,
    MonitoringExportService,
    LiveReplayMonitoringService,
    OptimizationAnalyticsService,
    PaperTradingMonitoringService,
    TradeAnalyticsService,
    SignalAnalyticsService,
    SignalActivityFeedService,
    BacktestMonitoringAnalyticsService,
    BacktestMonitoringQueryService
  ],
  controllers: [TradingStateController, BacktestMonitoringController],
  exports: [TradingStateService]
})
export class AdminModule {}
