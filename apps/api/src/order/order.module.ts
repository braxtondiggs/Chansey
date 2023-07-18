import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OrderController } from './order.controller';
import { Order } from './order.entity';
import { OrderService } from './order.service';
import { Testnet } from './testnet/testnet.entity';
import { TestnetService } from './testnet/testnet.service';
import User from '../users/users.entity';
import UsersService from '../users/users.service';

@Module({
  controllers: [OrderController],
  exports: [OrderService, TestnetService],
  imports: [ConfigModule, TypeOrmModule.forFeature([Order, Testnet, User])],
  providers: [OrderService, UsersService, TestnetService]
})
export class OrderModule {}
