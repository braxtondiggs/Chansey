import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OrderController } from './order.controller';
import { Order } from './order.entity';
import { OrderService } from './order.service';
import { TestnetController } from './testnet/testnet.controller';
import { Testnet } from './testnet/testnet.entity';
import { TestnetService } from './testnet/testnet.service';

import { Algorithm } from '../algorithm/algorithm.entity';
import { AlgorithmService } from '../algorithm/algorithm.service';
import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';
import { TickerPairs } from '../coin/ticker-pairs/ticker-pairs.entity';
import { TickerPairService } from '../coin/ticker-pairs/ticker-pairs.service';
import { ExchangeKeyModule } from '../exchange/exchange-key/exchange-key.module';
import { ExchangeModule } from '../exchange/exchange.module';

@Module({
  controllers: [OrderController, TestnetController],
  exports: [OrderService, TestnetService],
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Algorithm, Coin, Order, Testnet, TickerPairs]),
    forwardRef(() => ExchangeModule),
    forwardRef(() => ExchangeKeyModule)
  ],
  providers: [AlgorithmService, CoinService, OrderService, TestnetService, TickerPairService]
})
export class OrderModule {}
