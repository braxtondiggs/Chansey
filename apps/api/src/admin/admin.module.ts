import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BacktestMonitoringController } from './backtest-monitoring/backtest-monitoring.controller';
import { BacktestMonitoringService } from './backtest-monitoring/backtest-monitoring.service';
import { LiveTradeMonitoringModule } from './live-trade-monitoring/live-trade-monitoring.module';
import { TradingStateController } from './trading-state/trading-state.controller';
import { TradingState } from './trading-state/trading-state.entity';
import { TradingStateService } from './trading-state/trading-state.service';

import { AuditModule } from '../audit/audit.module';
import { OptimizationResult } from '../optimization/entities/optimization-result.entity';
import { OptimizationRun } from '../optimization/entities/optimization-run.entity';
import { Backtest, BacktestSignal, BacktestTrade, SimulatedOrderFill } from '../order/backtest/backtest.entity';
import { Order } from '../order/order.entity';
import { OrderModule } from '../order/order.module';
import { PaperTradingOrder } from '../order/paper-trading/entities/paper-trading-order.entity';
import { PaperTradingSession } from '../order/paper-trading/entities/paper-trading-session.entity';
import { PaperTradingSignal } from '../order/paper-trading/entities/paper-trading-signal.entity';
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
      Backtest,
      BacktestTrade,
      BacktestSignal,
      SimulatedOrderFill,
      OptimizationRun,
      OptimizationResult,
      PaperTradingSession,
      PaperTradingOrder,
      PaperTradingSignal
    ]),
    AuditModule,
    LiveTradeMonitoringModule,
    forwardRef(() => OrderModule),
    forwardRef(() => StrategyModule),
    forwardRef(() => TasksModule)
  ],
  providers: [TradingStateService, BacktestMonitoringService],
  controllers: [TradingStateController, BacktestMonitoringController],
  exports: [TradingStateService]
})
export class AdminModule {}
