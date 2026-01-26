import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  PaperTradingAccount,
  PaperTradingOrder,
  PaperTradingSession,
  PaperTradingSignal,
  PaperTradingSnapshot
} from './entities';
import { PaperTradingEngineService } from './paper-trading-engine.service';
import { PaperTradingMarketDataService } from './paper-trading-market-data.service';
import { PaperTradingRecoveryService } from './paper-trading-recovery.service';
import { PaperTradingStreamService } from './paper-trading-stream.service';
import { paperTradingConfig } from './paper-trading.config';
import { PaperTradingController } from './paper-trading.controller';
import { PaperTradingGateway } from './paper-trading.gateway';
import { PaperTradingProcessor } from './paper-trading.processor';
import { PaperTradingService } from './paper-trading.service';

import { Algorithm } from '../../algorithm/algorithm.entity';
import { AlgorithmModule } from '../../algorithm/algorithm.module';
import { AuthenticationModule } from '../../authentication/authentication.module';
import { ExchangeKey } from '../../exchange/exchange-key/exchange-key.entity';
import { ExchangeKeyModule } from '../../exchange/exchange-key/exchange-key.module';
import { ExchangeModule } from '../../exchange/exchange.module';
import { MetricsModule } from '../../metrics/metrics.module';
import { SharedCacheModule } from '../../shared-cache.module';
import { UsersModule } from '../../users/users.module';
import { BacktestSharedModule } from '../backtest/shared';

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
    MetricsModule
  ],
  controllers: [PaperTradingController],
  providers: [
    PaperTradingService,
    PaperTradingEngineService,
    PaperTradingMarketDataService,
    PaperTradingStreamService,
    PaperTradingProcessor,
    PaperTradingGateway,
    PaperTradingRecoveryService
  ],
  exports: [PaperTradingService, PaperTradingEngineService, PaperTradingMarketDataService]
})
export class PaperTradingModule {}
