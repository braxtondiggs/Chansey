import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LiveTradeMonitoringController } from './live-trade-monitoring.controller';
import { LiveTradeMonitoringService } from './live-trade-monitoring.service';

import { AlgorithmActivation } from '../../algorithm/algorithm-activation.entity';
import { AlgorithmPerformance } from '../../algorithm/algorithm-performance.entity';
import { Algorithm } from '../../algorithm/algorithm.entity';
import { AlgorithmModule } from '../../algorithm/algorithm.module';
import { Backtest, SimulatedOrderFill } from '../../order/backtest/backtest.entity';
import { Order } from '../../order/order.entity';
import { User } from '../../users/users.entity';

/**
 * LiveTradeMonitoringModule
 *
 * Provides admin dashboard for monitoring live trading activity and
 * comparing real performance against backtest predictions.
 *
 * All endpoints require admin role authorization.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      AlgorithmActivation,
      AlgorithmPerformance,
      Backtest,
      SimulatedOrderFill,
      Algorithm,
      User
    ]),
    forwardRef(() => AlgorithmModule)
  ],
  controllers: [LiveTradeMonitoringController],
  providers: [LiveTradeMonitoringService],
  exports: [LiveTradeMonitoringService]
})
export class LiveTradeMonitoringModule {}
