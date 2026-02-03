import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BacktestMonitoringController } from './backtest-monitoring/backtest-monitoring.controller';
import { BacktestMonitoringService } from './backtest-monitoring/backtest-monitoring.service';
import { TradingStateController } from './trading-state/trading-state.controller';
import { TradingState } from './trading-state/trading-state.entity';
import { TradingStateService } from './trading-state/trading-state.service';

import { AuditModule } from '../audit/audit.module';
import { Backtest, BacktestSignal, BacktestTrade, SimulatedOrderFill } from '../order/backtest/backtest.entity';
import { Order } from '../order/order.entity';
import { OrderModule } from '../order/order.module';
import { StrategyModule } from '../strategy/strategy.module';

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
    TypeOrmModule.forFeature([TradingState, Order, Backtest, BacktestTrade, BacktestSignal, SimulatedOrderFill]),
    AuditModule,
    forwardRef(() => OrderModule),
    forwardRef(() => StrategyModule)
  ],
  providers: [TradingStateService, BacktestMonitoringService],
  controllers: [TradingStateController, BacktestMonitoringController],
  exports: [TradingStateService]
})
export class AdminModule {}
