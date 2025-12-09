import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BacktestEngine } from './backtest/backtest-engine.service';
import { BacktestResultService } from './backtest/backtest-result.service';
import { BacktestStreamService } from './backtest/backtest-stream.service';
import { backtestConfig } from './backtest/backtest.config';
import { BacktestController, ComparisonReportController } from './backtest/backtest.controller';
import {
  Backtest,
  BacktestPerformanceSnapshot,
  BacktestSignal,
  BacktestTrade,
  SimulatedOrderFill
} from './backtest/backtest.entity';
import { BacktestGateway } from './backtest/backtest.gateway';
import { BacktestProcessor } from './backtest/backtest.processor';
import { BacktestService } from './backtest/backtest.service';
import { ComparisonReport, ComparisonReportRun } from './backtest/comparison-report.entity';
import { LiveReplayProcessor } from './backtest/live-replay.processor';
import { MarketDataSet } from './backtest/market-data-set.entity';
import { OrderController } from './order.controller';
import { Order } from './order.entity';
import { OrderService } from './order.service';
import { OrderCalculationService } from './services/order-calculation.service';
import { OrderSyncService } from './services/order-sync.service';
import { OrderValidationService } from './services/order-validation.service';
import { TradeExecutionService } from './services/trade-execution.service';
import { OrderSyncTask } from './tasks/order-sync.task';
import { TradeExecutionTask } from './tasks/trade-execution.task';

import { Algorithm } from '../algorithm/algorithm.entity';
import { AlgorithmModule } from '../algorithm/algorithm.module';
import { AlgorithmService } from '../algorithm/algorithm.service';
import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';
import { TickerPairs } from '../coin/ticker-pairs/ticker-pairs.entity';
import { TickerPairService } from '../coin/ticker-pairs/ticker-pairs.service';
import { ExchangeKeyModule } from '../exchange/exchange-key/exchange-key.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { PriceModule } from '../price/price.module';
import { SharedCacheModule } from '../shared-cache.module';
import { User } from '../users/users.entity';
import { UsersModule } from '../users/users.module';

const BACKTEST_DEFAULTS = backtestConfig();

@Module({
  controllers: [OrderController, BacktestController, ComparisonReportController],
  exports: [OrderService, OrderSyncTask, TradeExecutionService, BacktestService, BacktestEngine, BacktestStreamService],
  imports: [
    ConfigModule.forFeature(backtestConfig),
    TypeOrmModule.forFeature([
      Algorithm,
      Coin,
      Order,
      User,
      TickerPairs,
      Backtest,
      BacktestSignal,
      SimulatedOrderFill,
      MarketDataSet,
      BacktestTrade,
      BacktestPerformanceSnapshot,
      ComparisonReport,
      ComparisonReportRun
    ]),
    BullModule.registerQueue({ name: 'order-queue' }),
    BullModule.registerQueue({ name: BACKTEST_DEFAULTS.historicalQueue }),
    BullModule.registerQueue({ name: BACKTEST_DEFAULTS.replayQueue }),
    BullModule.registerQueue({ name: 'backtest-queue' }),
    BullModule.registerQueue({ name: 'trade-execution' }),
    SharedCacheModule,
    forwardRef(() => AlgorithmModule),
    forwardRef(() => ExchangeModule),
    forwardRef(() => ExchangeKeyModule),
    forwardRef(() => PriceModule),
    forwardRef(() => UsersModule)
  ],
  providers: [
    AlgorithmService,
    BacktestEngine,
    BacktestProcessor,
    LiveReplayProcessor,
    BacktestService,
    BacktestStreamService,
    BacktestResultService,
    BacktestGateway,
    CoinService,
    OrderCalculationService,
    OrderService,
    OrderSyncService,
    OrderSyncTask,
    OrderValidationService,
    TradeExecutionService,
    TradeExecutionTask,
    TickerPairService
  ]
})
export class OrderModule {}
