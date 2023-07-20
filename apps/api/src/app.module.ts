import { join } from 'path';

import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';

import { AlgorithmModule } from './algorithm/algorithm.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthenticationModule } from './authentication/authentication.module';
import { CategoryModule } from './category/category.module';
import { CoinModule } from './coin/coin.module';
import { ExchangeModule } from './exchange/exchange.module';
import { HealthModule } from './health/health.module';
import { OrderModule } from './order/order.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { PriceModule } from './price/price.module';
import { TaskModule } from './task/task.module';
import { HttpExceptionFilter } from './utils/filters/http-exception.filter';

const isProduction = process.env.NODE_ENV === 'production';
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        transport: {
          target: 'pino-pretty',
          options: {
            singleLine: true
          }
        }
      }
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '../dist/client'),
      exclude: ['/api/(.*)']
    }),

    TypeOrmModule.forRoot({
      autoLoadEntities: true,
      database: process.env.PGDATABASE,
      entities: [join(__dirname, '/../**/*.entity{.ts,.js}')],
      host: process.env.PGHOST,
      logging: !isProduction,
      migrations: [join(__dirname, 'migrations/*{.ts,.js}')],
      migrationsTableName: 'migration',
      password: process.env.PGPASSWORD,
      port: parseInt(process.env.PGPORT),
      // ssl: isProduction,
      synchronize: true, // TODO: Fix for production !isProduction,
      type: 'postgres',
      username: process.env.PGUSER,
      uuidExtension: 'pgcrypto'
    }),
    AlgorithmModule,
    AuthenticationModule,
    CategoryModule,
    CoinModule,
    ExchangeModule,
    HealthModule,
    OrderModule,
    PortfolioModule,
    PriceModule,
    TaskModule
  ],
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
