import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import { BullBoardModule } from '@bull-board/nestjs';
import { LoggerModule } from 'nestjs-pino';

import { join } from 'path';

import { AlgorithmModule } from './algorithm/algorithm.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthenticationModule } from './authentication/authentication.module';
import { BalanceModule } from './balance/balance.module';
import { CategoryModule } from './category/category.module';
import { CoinModule } from './coin/coin.module';
import { ExchangeModule } from './exchange/exchange.module';
import { HealthModule } from './health/health.module';
import { OrderModule } from './order/order.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { PriceModule } from './price/price.module';
import { RiskModule } from './risk/risk.module';
import { StorageModule } from './storage/storage.module';
import { HttpExceptionFilter } from './utils/filters/http-exception.filter';

const isProduction = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        transport: isProduction
          ? undefined
          : {
              target: 'pino-pretty',
              options: {
                colorize: true,
                colorizeObjects: true,
                singleLine: false,
                translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
                ignore: 'pid,hostname,req.headers,res.headers',
                messageFormat: '[{level}] {time} - {msg}',
                levelFirst: true,
                hideObject: false,
                sync: false,
                append: false,
                mkdir: true
              }
            },
        level: isProduction ? 'info' : 'debug',
        autoLogging: false, // Disable automatic HTTP request logging
        serializers: {
          req: (req) => ({
            method: req.method,
            url: req.url,
            headers: {
              'user-agent': req.headers['user-agent'],
              'content-type': req.headers['content-type']
            }
          }),
          res: (res) => ({
            statusCode: res.statusCode
          })
        }
      }
    }),
    StorageModule,
    TypeOrmModule.forRoot({
      autoLoadEntities: true,
      database: process.env.PGDATABASE,
      entities: [join(__dirname, '/../**/*.entity{.ts,.js}')],
      host: process.env.PGHOST,
      logging: !isProduction,
      migrations: [join(__dirname, './migrations/*.{ts,js}')],
      migrationsTableName: 'migration',
      password: process.env.PGPASSWORD,
      port: parseInt(process.env.PGPORT),
      // ssl: isProduction,
      synchronize: true, // TODO: Fix for production !isProduction,
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
    BullBoardModule.forFeature(
      { name: 'category-queue', adapter: BullMQAdapter },
      { name: 'coin-queue', adapter: BullMQAdapter },
      { name: 'exchange-queue', adapter: BullMQAdapter },
      { name: 'order-queue', adapter: BullMQAdapter },
      { name: 'price-queue', adapter: BullMQAdapter },
      { name: 'ticker-pairs-queue', adapter: BullMQAdapter },
      { name: 'user-queue', adapter: BullMQAdapter }
    ),
    ScheduleModule.forRoot(),
    AlgorithmModule,
    AuthenticationModule,
    BalanceModule,
    CategoryModule,
    CoinModule,
    ConfigModule,
    ExchangeModule,
    HealthModule,
    HttpModule,
    OrderModule,
    PortfolioModule,
    PriceModule,
    RiskModule
  ],
  exports: [ConfigModule, HttpModule],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: 'APP_FILTER',
      useClass: HttpExceptionFilter
    }
  ]
})
export class AppModule {}
