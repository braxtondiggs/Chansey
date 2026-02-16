import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BacktestEngine } from './backtest/backtest-engine.service';
import { BacktestPauseService } from './backtest/backtest-pause.service';
import { BacktestRecoveryService } from './backtest/backtest-recovery.service';
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
import { CoinResolverService } from './backtest/coin-resolver.service';
import { ComparisonReport, ComparisonReportRun } from './backtest/comparison-report.entity';
import { DatasetValidatorService } from './backtest/dataset-validator.service';
import { LiveReplayProcessor } from './backtest/live-replay.processor';
import { MarketDataReaderService } from './backtest/market-data-reader.service';
import { MarketDataSet } from './backtest/market-data-set.entity';
import { QuoteCurrencyResolverService } from './backtest/quote-currency-resolver.service';
import { BacktestSharedModule } from './backtest/shared';
import { orderCleanupConfig } from './config/order-cleanup.config';
import { slippageLimitsConfig } from './config/slippage-limits.config';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { PositionExit } from './entities/position-exit.entity';
import { OrderController } from './order.controller';
import { Order } from './order.entity';
import { OrderService } from './order.service';
import { PaperTradingModule } from './paper-trading/paper-trading.module';
import { OrderCalculationService } from './services/order-calculation.service';
import { OrderCleanupService } from './services/order-cleanup.service';
import { OrderStateMachineService } from './services/order-state-machine.service';
import { OrderSyncService } from './services/order-sync.service';
import { OrderValidationService } from './services/order-validation.service';
import { PositionManagementService } from './services/position-management.service';
import { SlippageAnalysisService } from './services/slippage-analysis.service';
import { TradeExecutionService } from './services/trade-execution.service';
import { OrderSyncTask } from './tasks/order-sync.task';
import { PositionMonitorTask } from './tasks/position-monitor.task';
import { TradeExecutionTask } from './tasks/trade-execution.task';

import { Algorithm } from '../algorithm/algorithm.entity';
import { AlgorithmModule } from '../algorithm/algorithm.module';
import { AlgorithmService } from '../algorithm/algorithm.service';
import { IndicatorModule } from '../algorithm/indicators/indicator.module';
import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';
import { TickerPairs } from '../coin/ticker-pairs/ticker-pairs.entity';
import { TickerPairService } from '../coin/ticker-pairs/ticker-pairs.service';
import { ExchangeKeyModule } from '../exchange/exchange-key/exchange-key.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { MetricsModule } from '../metrics/metrics.module';
import { OHLCModule } from '../ohlc/ohlc.module';
import { SharedCacheModule } from '../shared-cache.module';
import { StorageModule } from '../storage/storage.module';
import { StrategyConfig } from '../strategy/entities/strategy-config.entity';
import { User } from '../users/users.entity';
import { UsersModule } from '../users/users.module';

const BACKTEST_DEFAULTS = backtestConfig();

@Module({
  controllers: [OrderController, BacktestController, ComparisonReportController],
  exports: [
    OrderService,
    OrderSyncTask,
    TradeExecutionService,
    BacktestService,
    BacktestEngine,
    BacktestStreamService,
    BacktestResultService,
    SlippageAnalysisService,
    PositionManagementService,
    OrderStateMachineService
  ],
  imports: [
    ConfigModule.forFeature(backtestConfig),
    ConfigModule.forFeature(orderCleanupConfig),
    ConfigModule.forFeature(slippageLimitsConfig),
    TypeOrmModule.forFeature([
      Algorithm,
      Coin,
      Order,
      OrderStatusHistory,
      User,
      TickerPairs,
      Backtest,
      BacktestSignal,
      SimulatedOrderFill,
      MarketDataSet,
      BacktestTrade,
      BacktestPerformanceSnapshot,
      ComparisonReport,
      ComparisonReportRun,
      PositionExit,
      StrategyConfig
    ]),
    BullModule.registerQueue({ name: 'order-queue' }),
    BullModule.registerQueue({ name: BACKTEST_DEFAULTS.historicalQueue }),
    BullModule.registerQueue({ name: BACKTEST_DEFAULTS.replayQueue }),
    BullModule.registerQueue({ name: 'trade-execution' }),
    BullModule.registerQueue({ name: 'position-monitor' }),
    SharedCacheModule,
    forwardRef(() => AlgorithmModule),
    forwardRef(() => ExchangeModule),
    forwardRef(() => ExchangeKeyModule),
    forwardRef(() => OHLCModule),
    forwardRef(() => UsersModule),
    IndicatorModule,
    MetricsModule,
    StorageModule,
    BacktestSharedModule,
    PaperTradingModule
  ],
  providers: [
    AlgorithmService,
    BacktestEngine,
    BacktestProcessor,
    BacktestRecoveryService,
    LiveReplayProcessor,
    BacktestPauseService,
    BacktestService,
    BacktestStreamService,
    BacktestResultService,
    BacktestGateway,
    CoinResolverService,
    CoinService,
    DatasetValidatorService,
    MarketDataReaderService,
    QuoteCurrencyResolverService,
    OrderCalculationService,
    OrderCleanupService,
    OrderService,
    OrderStateMachineService,
    OrderSyncService,
    OrderSyncTask,
    OrderValidationService,
    PositionManagementService,
    PositionMonitorTask,
    SlippageAnalysisService,
    TradeExecutionService,
    TradeExecutionTask,
    TickerPairService
  ]
})
export class OrderModule {}
