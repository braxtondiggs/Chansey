import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TradingStateController } from './trading-state/trading-state.controller';
import { TradingState } from './trading-state/trading-state.entity';
import { TradingStateService } from './trading-state/trading-state.service';

import { AuditModule } from '../audit/audit.module';
import { Order } from '../order/order.entity';
import { OrderModule } from '../order/order.module';
import { StrategyModule } from '../strategy/strategy.module';

/**
 * AdminModule
 *
 * Contains admin-only features including:
 * - Global trading kill switch
 * - System status monitoring
 *
 * All endpoints require admin role authorization.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([TradingState, Order]),
    AuditModule,
    forwardRef(() => OrderModule),
    forwardRef(() => StrategyModule)
  ],
  providers: [TradingStateService],
  controllers: [TradingStateController],
  exports: [TradingStateService]
})
export class AdminModule {}
