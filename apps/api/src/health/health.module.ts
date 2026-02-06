import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller';
import {
  BullMQHealthIndicator,
  DatabasePoolHealthIndicator,
  ExchangeHealthIndicator,
  OHLCHealthIndicator,
  RedisHealthIndicator
} from './indicators';

import { ExchangeModule } from '../exchange/exchange.module';
import { OHLCModule } from '../ohlc/ohlc.module';

@Module({
  imports: [
    TerminusModule.forRoot({
      errorLogStyle: 'pretty'
    }),
    BullModule.registerQueue(
      { name: 'order-queue' },
      { name: 'coin-queue' },
      { name: 'price-queue' },
      { name: 'strategy-evaluation-queue' },
      { name: 'regime-check-queue' }
    ),
    ExchangeModule,
    OHLCModule
  ],
  controllers: [HealthController],
  providers: [
    BullMQHealthIndicator,
    DatabasePoolHealthIndicator,
    ExchangeHealthIndicator,
    OHLCHealthIndicator,
    RedisHealthIndicator
  ]
})
export class HealthModule {}
