import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import User from '../users/users.entity';
import UsersService from '../users/users.service';

@Module({
  controllers: [OrderController],
  exports: [OrderService],
  imports: [TypeOrmModule.forFeature([User])],
  providers: [OrderService, UsersService]
})
export class OrderModule {}
