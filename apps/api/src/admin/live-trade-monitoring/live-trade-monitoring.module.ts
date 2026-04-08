import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LiveTradeAlertsService } from './live-trade-alerts.service';
import { LiveTradeAlgorithmsService } from './live-trade-algorithms.service';
import { LiveTradeComparisonService } from './live-trade-comparison.service';
import { LiveTradeMonitoringController } from './live-trade-monitoring.controller';
import { LiveTradeOrdersService } from './live-trade-orders.service';
import { LiveTradeOverviewService } from './live-trade-overview.service';
import { LiveTradeSlippageService } from './live-trade-slippage.service';
import { LiveTradeUserActivityService } from './live-trade-user-activity.service';

import { AlgorithmActivation } from '../../algorithm/algorithm-activation.entity';
import { AlgorithmPerformance } from '../../algorithm/algorithm-performance.entity';
import { Algorithm } from '../../algorithm/algorithm.entity';
import { AlgorithmModule } from '../../algorithm/algorithm.module';
import { ExchangeKey } from '../../exchange/exchange-key/exchange-key.entity';
import { Backtest } from '../../order/backtest/backtest.entity';
import { SimulatedOrderFill } from '../../order/backtest/simulated-order-fill.entity';
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
      User,
      ExchangeKey
    ]),
    forwardRef(() => AlgorithmModule)
  ],
  controllers: [LiveTradeMonitoringController],
  providers: [
    LiveTradeOverviewService,
    LiveTradeAlgorithmsService,
    LiveTradeOrdersService,
    LiveTradeComparisonService,
    LiveTradeSlippageService,
    LiveTradeUserActivityService,
    LiveTradeAlertsService
  ]
})
export class LiveTradeMonitoringModule {}
