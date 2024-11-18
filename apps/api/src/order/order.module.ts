import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Algorithm } from './../algorithm/algorithm.entity';
import { AlgorithmService } from './../algorithm/algorithm.service';
import { Exchange } from './../exchange/exchange.entity';
import { OrderController } from './order.controller';
import { Order } from './order.entity';
import { OrderService } from './order.service';
import { TestnetController } from './testnet/testnet.controller';
import { Testnet } from './testnet/testnet.entity';
import { TestnetService } from './testnet/testnet.service';
import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';
import { TickerPairs } from '../coin/ticker-pairs/ticker-pairs.entity';
import { TickerPairService } from '../coin/ticker-pairs/ticker-pairs.service';
import { BinanceService } from '../exchange/binance/binance.service';
import { ExchangeService } from '../exchange/exchange.service';

@Module({
  controllers: [OrderController, TestnetController],
  exports: [OrderService, TestnetService],
  imports: [ConfigModule, TypeOrmModule.forFeature([Algorithm, Coin, Exchange, Order, Testnet, TickerPairs])],
  providers: [
    AlgorithmService,
    BinanceService,
    CoinService,
    ExchangeService,
    OrderService,
    TestnetService,
    TickerPairService
  ]
})
export class OrderModule {}
