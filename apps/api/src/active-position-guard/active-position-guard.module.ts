import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ActivePositionGuardService } from './active-position-guard.service';

import { Coin } from '../coin/coin.entity';
import { PositionExit } from '../order/entities/position-exit.entity';
import { Order } from '../order/order.entity';
import { PaperTradingOrder } from '../order/paper-trading/entities/paper-trading-order.entity';
import { LiveTradingSignal } from '../strategy/entities/live-trading-signal.entity';
import { UserStrategyPosition } from '../strategy/entities/user-strategy-position.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, PaperTradingOrder, PositionExit, UserStrategyPosition, LiveTradingSignal, Coin])
  ],
  providers: [ActivePositionGuardService],
  exports: [ActivePositionGuardService]
})
export class ActivePositionGuardModule {}
