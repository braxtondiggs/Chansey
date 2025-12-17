import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import { BullBoardModule } from '@bull-board/nestjs';
import { LoggerModule } from 'nestjs-pino';

import { join } from 'path';

import { AlgorithmModule } from './algorithm/algorithm.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuditModule } from './audit/audit.module';
import { AuthenticationModule } from './authentication/authentication.module';
import { BalanceModule } from './balance/balance.module';
import { CategoryModule } from './category/category.module';
import { CoinModule } from './coin/coin.module';
import { validateEnv } from './config/env.validation';
import { createLoggerConfig } from './config/logger.config';
import { ExchangeModule } from './exchange/exchange.module';
import { HealthModule } from './health/health.module';
import { MarketRegimeModule } from './market-regime/market-regime.module';
import { MetricsModule } from './metrics/metrics.module';
import { OptimizationModule } from './optimization/optimization.module';
import { OrderModule } from './order/order.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { PriceModule } from './price/price.module';
import { RiskModule } from './risk/risk.module';
import { ScoringModule } from './scoring/scoring.module';
import { QUEUE_NAMES } from './shutdown/queue-names.constant';
import { ShutdownModule } from './shutdown/shutdown.module';
import { StorageModule } from './storage/storage.module';
import { StrategyModule } from './strategy/strategy.module';
import { TasksModule } from './tasks/tasks.module';
import { TradingModule } from './trading/trading.module';
import { HttpExceptionFilter } from './utils/filters/http-exception.filter';

const isProduction = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    LoggerModule.forRoot(createLoggerConfig()),
    StorageModule,
    TypeOrmModule.forRoot({
      autoLoadEntities: true,
      database: process.env.PGDATABASE,
      entities: [join(__dirname, '/../**/*.entity{.ts,.js}')],
      host: process.env.PGHOST,
      logging: !isProduction,
      migrations: [join(__dirname, './migrations/*.{ts,js}')],
      migrationsTableName: 'migration',
      migrationsRun: isProduction, // Auto-run migrations on startup in production
      password: process.env.PGPASSWORD,
      port: parseInt(process.env.PGPORT),
      // ssl: isProduction,
      synchronize: !isProduction, // Only sync in development, use migrations in production
      type: 'postgres',
      username: process.env.PGUSER,
      uuidExtension: 'pgcrypto'
    }),
    BullModule.forRoot({
      connection: {
        family: 0,
        db: 3,
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT),
        username: process.env.REDIS_USER,
        password: process.env.REDIS_PASSWORD,
        tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        retryStrategy: (times) => {
          // Exponential backoff with a max of 3 seconds
          return Math.min(Math.exp(times), 3000);
        }
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
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      cache: true,
      validate: validateEnv // Validates env vars on startup
    }),
    AlgorithmModule,
    AuditModule,
    AuthenticationModule,
    BalanceModule,
    CategoryModule,
    CoinModule,
    ExchangeModule,
    HealthModule,
    HttpModule,
    MarketRegimeModule,
    MetricsModule,
    OptimizationModule,
    OrderModule,
    PortfolioModule,
    PriceModule,
    RiskModule,
    ScoringModule,
    ShutdownModule,
    StorageModule,
    StrategyModule,
    TasksModule,
    TradingModule
  ],
  exports: [ConfigModule, HttpModule],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: 'APP_FILTER',
      useClass: HttpExceptionFilter
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard
    }
  ]
})
export class AppModule {}
