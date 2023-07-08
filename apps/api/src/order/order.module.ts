import { Module } from '@nestjs/common';

import { OrderController } from './order.controller';
import { OrderService } from './order.service';

@Module({
  providers: [OrderService],
  controllers: [OrderController],
  exports: [OrderService]
})
export class OrderModule {}
