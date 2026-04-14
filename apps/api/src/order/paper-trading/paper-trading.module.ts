import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PaperTradingExitExecutorService } from './engine/paper-trading-exit-executor.service';
import { PaperTradingOpportunitySellingService } from './engine/paper-trading-opportunity-selling.service';
import { PaperTradingOrderExecutorService } from './engine/paper-trading-order-executor.service';
import { PaperTradingPortfolioService } from './engine/paper-trading-portfolio.service';
import { PaperTradingSignalService } from './engine/paper-trading-signal.service';
import { PaperTradingSnapshotService } from './engine/paper-trading-snapshot.service';
import { PaperTradingThrottleService } from './engine/paper-trading-throttle.service';
import {
  PaperTradingAccount,
  PaperTradingOrder,
  PaperTradingSession,
  PaperTradingSignal,
  PaperTradingSnapshot
} from './entities';
import { PaperTradingEngineService } from './paper-trading-engine.service';
import { PaperTradingJobService } from './paper-trading-job.service';
import { PaperTradingMarketDataService } from './paper-trading-market-data.service';
import { PaperTradingQueryService } from './paper-trading-query.service';
import { PaperTradingRecoveryService } from './paper-trading-recovery.service';
import { PaperTradingRetryService } from './paper-trading-retry.service';
import { PaperTradingSlippageService } from './paper-trading-slippage.service';
import { PaperTradingStreamService } from './paper-trading-stream.service';
import { paperTradingConfig } from './paper-trading.config';
import { PaperTradingController } from './paper-trading.controller';
import { PaperTradingGateway } from './paper-trading.gateway';
import { PaperTradingProcessor } from './paper-trading.processor';
import { PaperTradingService } from './paper-trading.service';

import { Algorithm } from '../../algorithm/algorithm.entity';
import { AlgorithmModule } from '../../algorithm/algorithm.module';
import { AuthenticationModule } from '../../authentication/authentication.module';
import { CoinModule } from '../../coin/coin.module';
import { CoinSelectionModule } from '../../coin-selection/coin-selection.module';
import { ExchangeKey } from '../../exchange/exchange-key/exchange-key.entity';
import { ExchangeKeyModule } from '../../exchange/exchange-key/exchange-key.module';
import { ExchangeModule } from '../../exchange/exchange.module';
import { MarketRegimeModule } from '../../market-regime/market-regime.module';
import { MetricsModule } from '../../metrics/metrics.module';
import { OHLCModule } from '../../ohlc/ohlc.module';
import { SharedCacheModule } from '../../shared-cache.module';
import { UsersModule } from '../../users/users.module';
import { BacktestSharedModule } from '../backtest/shared/shared.module';

const PAPER_TRADING_CONFIG = paperTradingConfig();

@Module({
  imports: [
    ConfigModule.forFeature(paperTradingConfig),
    TypeOrmModule.forFeature([
      PaperTradingSession,
      PaperTradingAccount,
      PaperTradingOrder,
      PaperTradingSignal,
      PaperTradingSnapshot,
      Algorithm,
      ExchangeKey
    ]),
    BullModule.registerQueue({ name: PAPER_TRADING_CONFIG.queue }),
    EventEmitterModule.forRoot(),
    SharedCacheModule,
    BacktestSharedModule,
    forwardRef(() => AlgorithmModule),
    forwardRef(() => AuthenticationModule),
    forwardRef(() => ExchangeModule),
    forwardRef(() => ExchangeKeyModule),
    forwardRef(() => UsersModule),
    forwardRef(() => OHLCModule),
    forwardRef(() => MarketRegimeModule),
    forwardRef(() => CoinModule),
    forwardRef(() => CoinSelectionModule),
    MetricsModule
  ],
  controllers: [PaperTradingController],
  providers: [
    PaperTradingService,
    PaperTradingQueryService,
    PaperTradingJobService,
    PaperTradingEngineService,
    PaperTradingPortfolioService,
    PaperTradingSignalService,
    PaperTradingSnapshotService,
    PaperTradingThrottleService,
    PaperTradingOrderExecutorService,
    PaperTradingExitExecutorService,
    PaperTradingOpportunitySellingService,
    PaperTradingMarketDataService,
    PaperTradingSlippageService,
    PaperTradingStreamService,
    PaperTradingProcessor,
    PaperTradingGateway,
    PaperTradingRecoveryService,
    PaperTradingRetryService
  ],
  exports: [
    PaperTradingService,
    PaperTradingQueryService,
    PaperTradingJobService,
    PaperTradingEngineService,
    PaperTradingMarketDataService
  ]
})
export class PaperTradingModule {}
