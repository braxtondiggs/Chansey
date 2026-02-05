import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import { BullBoardModule } from '@bull-board/nestjs';
import { LoggerModule } from 'nestjs-pino';

import { AdminModule } from './admin/admin.module';
import { AlgorithmModule } from './algorithm/algorithm.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuditModule } from './audit/audit.module';
import { AuthenticationModule } from './authentication/authentication.module';
import { BalanceModule } from './balance/balance.module';
import { CategoryModule } from './category/category.module';
import { CoinModule } from './coin/coin.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { databaseConfig } from './config/database.config';
import { validateEnv } from './config/env.validation';
import { createLoggerConfig } from './config/logger.config';
import { redisConfig, RedisConfig } from './config/redis.config';
import { ExchangeModule } from './exchange/exchange.module';
import { HealthModule } from './health/health.module';
import { MarketRegimeModule } from './market-regime/market-regime.module';
import { MetricsModule } from './metrics/metrics.module';
import { OHLCModule } from './ohlc/ohlc.module';
import { OptimizationModule } from './optimization/optimization.module';
import { OrderModule } from './order/order.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { RiskModule } from './risk/risk.module';
import { ScoringModule } from './scoring/scoring.module';
import { SharedLockModule } from './shared/shared-lock.module';
import { SharedResilienceModule } from './shared/shared-resilience.module';
import { QUEUE_NAMES } from './shutdown/queue-names.constant';
import { ShutdownModule } from './shutdown/shutdown.module';
import { StorageModule } from './storage/storage.module';
import { StrategyModule } from './strategy/strategy.module';
import { TasksModule } from './tasks/tasks.module';
import { TradingModule } from './trading/trading.module';

@Module({
  imports: [
    // ConfigModule FIRST - must be available for other modules
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      cache: true,
      validate: validateEnv,
      load: [databaseConfig, redisConfig]
    }),
    LoggerModule.forRoot(createLoggerConfig()),
    StorageModule,

    // TypeORM with ConfigService
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => configService.get('database')
    }),

    // BullMQ with ConfigService
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redis = configService.get<RedisConfig>('redis');
        return {
          connection: {
            family: 0,
            db: 3,
            host: redis.host,
            port: redis.port,
            username: redis.username,
            password: redis.password,
            tls: redis.tls ? {} : undefined,
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
            retryStrategy: (times: number) => Math.min(Math.exp(times), 3000)
          }
        };
      }
    }),
    BullBoardModule.forRoot({
      route: '/bull-board',
      adapter: FastifyAdapter
    }),
    BullBoardModule.forFeature(...QUEUE_NAMES.map((name) => ({ name, adapter: BullMQAdapter }))),
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000, // 1 second
        limit: 10 // 10 requests per second
      },
      {
        name: 'medium',
        ttl: 60000, // 1 minute
        limit: 100 // 100 requests per minute
      },
      {
        name: 'long',
        ttl: 3600000, // 1 hour
        limit: 1000 // 1000 requests per hour
      }
    ]),
    ScheduleModule.forRoot(),
    AdminModule,
    AlgorithmModule,
    AuditModule,
    AuthenticationModule,
    BalanceModule,
    CategoryModule,
    CoinModule,
    ExchangeModule,
    HealthModule,
    MarketRegimeModule,
    MetricsModule,
    OHLCModule,
    OptimizationModule,
    OrderModule,
    PipelineModule,
    PortfolioModule,
    RiskModule,
    ScoringModule,
    SharedLockModule,
    SharedResilienceModule,
    ShutdownModule,
    StrategyModule,
    TasksModule,
    TradingModule
  ],
  exports: [ConfigModule],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: 'APP_FILTER',
      useClass: GlobalExceptionFilter
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard
    }
  ]
})
export class AppModule {}
