import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Algorithm } from './../algorithm/algorithm.entity';
import { AlgorithmService } from './../algorithm/algorithm.service';
import { OrderController } from './order.controller';
import { Order } from './order.entity';
import { OrderService } from './order.service';
import { TestnetController } from './testnet/testnet.controller';
import { Testnet } from './testnet/testnet.entity';
import { TestnetService } from './testnet/testnet.service';
import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';
import { Ticker } from '../exchange/ticker/ticker.entity';
import { TickerService } from '../exchange/ticker/ticker.service';
import { User } from '../users/users.entity';
import UsersService from '../users/users.service';

@Module({
  controllers: [OrderController, TestnetController],
  exports: [OrderService, TestnetService],
  imports: [ConfigModule, TypeOrmModule.forFeature([Algorithm, Coin, Order, Testnet, Ticker, User])],
  providers: [AlgorithmService, CoinService, OrderService, UsersService, TestnetService, TickerService]
})
export class OrderModule {}
