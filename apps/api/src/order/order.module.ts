import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BacktestEngine } from './backtest/backtest-engine.service';
import { BacktestPauseService } from './backtest/backtest-pause.service';
import { BacktestPerformanceSnapshot } from './backtest/backtest-performance-snapshot.entity';
import { BacktestRecoveryService } from './backtest/backtest-recovery.service';
import { BacktestResultService } from './backtest/backtest-result.service';
import { BacktestSignal } from './backtest/backtest-signal.entity';
import { BacktestStreamService } from './backtest/backtest-stream.service';
import { BacktestTrade } from './backtest/backtest-trade.entity';
import { backtestConfig } from './backtest/backtest.config';
import { BacktestController, ComparisonReportController } from './backtest/backtest.controller';
import { Backtest } from './backtest/backtest.entity';
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
import { SimulatedOrderFill } from './backtest/simulated-order-fill.entity';
import { orderCleanupConfig } from './config/order-cleanup.config';
import { slippageLimitsConfig } from './config/slippage-limits.config';
import { OpportunitySellEvaluation } from './entities/opportunity-sell-evaluation.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { PositionExit } from './entities/position-exit.entity';
import { OrderController } from './order.controller';
import { Order } from './order.entity';
import { OrderService } from './order.service';
import { PaperTradingModule } from './paper-trading/paper-trading.module';
import { ExitOrderPlacementService } from './services/exit-order-placement.service';
import { ExitPriceService } from './services/exit-price.service';
import { LiquidationMonitorService } from './services/liquidation-monitor.service';
import { OpportunitySellService } from './services/opportunity-sell.service';
import { OrderCalculationService } from './services/order-calculation.service';
import { OrderCleanupService } from './services/order-cleanup.service';
import { OrderConversionService } from './services/order-conversion.service';
import { OrderStateMachineService } from './services/order-state-machine.service';
import { OrderSyncService } from './services/order-sync.service';
import { OrderValidationService } from './services/order-validation.service';
import { PositionAnalysisService } from './services/position-analysis.service';
import { PositionManagementService } from './services/position-management.service';
import { PositionMonitorService } from './services/position-monitor.service';
import { SlippageAnalysisService } from './services/slippage-analysis.service';
import { TradeExecutionService } from './services/trade-execution.service';
import { TradeOrchestratorService } from './services/trade-orchestrator.service';
import { TradeSignalGeneratorService } from './services/trade-signal-generator.service';
import { LiquidationMonitorTask } from './tasks/liquidation-monitor.task';
import { OrderSyncTask } from './tasks/order-sync.task';
import { PositionMonitorTask } from './tasks/position-monitor.task';
import { TradeExecutionTask } from './tasks/trade-execution.task';

import { AdminModule } from '../admin/admin.module';
import { AlgorithmActivation } from '../algorithm/algorithm-activation.entity';
import { AlgorithmPerformance } from '../algorithm/algorithm-performance.entity';
import { Algorithm } from '../algorithm/algorithm.entity';
import { AlgorithmModule } from '../algorithm/algorithm.module';
import { AlgorithmService } from '../algorithm/algorithm.service';
import { IndicatorModule } from '../algorithm/indicators/indicator.module';
import { BalanceModule } from '../balance/balance.module';
import { CoinDailySnapshot } from '../coin/coin-daily-snapshot.entity';
import { CoinDailySnapshotService } from '../coin/coin-daily-snapshot.service';
import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';
import { TickerPairs } from '../coin/ticker-pairs/ticker-pairs.entity';
import { TickerPairService } from '../coin/ticker-pairs/ticker-pairs.service';
import { ExchangeKeyModule } from '../exchange/exchange-key/exchange-key.module';
import { ExchangeSelectionModule } from '../exchange/exchange-selection/exchange-selection.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { FailedJobModule } from '../failed-jobs/failed-job.module';
import { MarketRegimeModule } from '../market-regime/market-regime.module';
import { MetricsModule } from '../metrics/metrics.module';
import { OHLCModule } from '../ohlc/ohlc.module';
import { SharedCacheModule } from '../shared-cache.module';
import { ShutdownModule } from '../shutdown/shutdown.module';
import { StorageModule } from '../storage/storage.module';
import { StrategyConfig } from '../strategy/entities/strategy-config.entity';
import { UserStrategyPosition } from '../strategy/entities/user-strategy-position.entity';
import { StrategyModule } from '../strategy/strategy.module';
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
    LiquidationMonitorService,
    PositionManagementService,
    OrderStateMachineService,
    OpportunitySellService,
    PositionAnalysisService,
    BacktestSharedModule
  ],
  imports: [
    ConfigModule.forFeature(backtestConfig),
    ConfigModule.forFeature(orderCleanupConfig),
    ConfigModule.forFeature(slippageLimitsConfig),
    TypeOrmModule.forFeature([
      Algorithm,
      AlgorithmActivation,
      AlgorithmPerformance,
      Coin,
      CoinDailySnapshot,
      Order,
      OrderStatusHistory,
      OpportunitySellEvaluation,
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
      StrategyConfig,
      UserStrategyPosition
    ]),
    BullModule.registerQueue({ name: 'order-queue' }),
    BullModule.registerQueue({ name: BACKTEST_DEFAULTS.historicalQueue }),
    BullModule.registerQueue({ name: BACKTEST_DEFAULTS.replayQueue }),
    BullModule.registerQueue({ name: 'trade-execution' }),
    BullModule.registerQueue({ name: 'position-monitor' }),
    BullModule.registerQueue({ name: 'liquidation-monitor' }),
    SharedCacheModule,
    FailedJobModule,
    forwardRef(() => AdminModule),
    forwardRef(() => AlgorithmModule),
    forwardRef(() => BalanceModule),
    forwardRef(() => ExchangeModule),
    forwardRef(() => ExchangeKeyModule),
    ExchangeSelectionModule,
    forwardRef(() => OHLCModule),
    forwardRef(() => UsersModule),
    forwardRef(() => MarketRegimeModule),
    forwardRef(() => StrategyModule),
    IndicatorModule,
    MetricsModule,
    StorageModule,
    BacktestSharedModule,
    PaperTradingModule,
    ShutdownModule
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
    CoinDailySnapshotService,
    CoinResolverService,
    CoinService,
    DatasetValidatorService,
    ExitOrderPlacementService,
    ExitPriceService,
    LiquidationMonitorService,
    LiquidationMonitorTask,
    MarketDataReaderService,
    QuoteCurrencyResolverService,
    OpportunitySellService,
    OrderCalculationService,
    OrderCleanupService,
    OrderConversionService,
    OrderService,
    OrderStateMachineService,
    OrderSyncService,
    OrderSyncTask,
    OrderValidationService,
    PositionAnalysisService,
    PositionManagementService,
    PositionMonitorService,
    PositionMonitorTask,
    SlippageAnalysisService,
    TradeExecutionService,
    TradeExecutionTask,
    TradeOrchestratorService,
    TradeSignalGeneratorService,
    TickerPairService
  ]
})
export class OrderModule {}
