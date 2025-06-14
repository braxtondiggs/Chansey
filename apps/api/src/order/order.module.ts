import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BacktestEngine } from './backtest/backtest-engine.service';
import { BacktestController } from './backtest/backtest.controller';
import { Backtest, BacktestTrade, BacktestPerformanceSnapshot } from './backtest/backtest.entity';
import { BacktestProcessor } from './backtest/backtest.processor';
import { BacktestService } from './backtest/backtest.service';
import { OrderController } from './order.controller';
import { Order } from './order.entity';
import { OrderService } from './order.service';
import { OrderCalculationService } from './services/order-calculation.service';
import { OrderSyncService } from './services/order-sync.service';
import { OrderValidationService } from './services/order-validation.service';
import { OrderSyncTask } from './tasks/order-sync.task';

import { Algorithm } from '../algorithm/algorithm.entity';
import { AlgorithmService } from '../algorithm/algorithm.service';
import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';
import { TickerPairs } from '../coin/ticker-pairs/ticker-pairs.entity';
import { TickerPairService } from '../coin/ticker-pairs/ticker-pairs.service';
import { ExchangeKeyModule } from '../exchange/exchange-key/exchange-key.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { PriceModule } from '../price/price.module';
import { UsersModule } from '../users/users.module';

@Module({
  controllers: [OrderController, BacktestController],
  exports: [OrderService, OrderSyncTask, BacktestService, BacktestEngine],
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      Algorithm,
      Coin,
      Order,
      TickerPairs,
      Backtest,
      BacktestTrade,
      BacktestPerformanceSnapshot
    ]),
    BullModule.registerQueue({ name: 'order-queue' }),
    BullModule.registerQueue({ name: 'backtest-queue' }),
    forwardRef(() => ExchangeModule),
    forwardRef(() => ExchangeKeyModule),
    forwardRef(() => PriceModule),
    forwardRef(() => UsersModule)
  ],
  providers: [
    AlgorithmService,
    BacktestEngine,
    BacktestProcessor,
    BacktestService,
    CoinService,
    OrderCalculationService,
    OrderService,
    OrderSyncService,
    OrderSyncTask,
    OrderValidationService,
    TickerPairService
  ]
})
export class OrderModule {}
