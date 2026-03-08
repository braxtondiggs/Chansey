import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ExchangeSelectionService } from './exchange-selection.service';

import { Order } from '../../order/order.entity';
import { UserStrategyPosition } from '../../strategy/entities/user-strategy-position.entity';
import { ExchangeKeyModule } from '../exchange-key/exchange-key.module';
import { ExchangeModule } from '../exchange.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserStrategyPosition, Order]),
    forwardRef(() => ExchangeKeyModule),
    forwardRef(() => ExchangeModule)
  ],
  providers: [ExchangeSelectionService],
  exports: [ExchangeSelectionService]
})
export class ExchangeSelectionModule {}
