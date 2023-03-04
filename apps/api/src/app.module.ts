import { join } from 'path';

import { MikroORM } from '@mikro-orm/core';
import { MikroOrmMiddleware, MikroOrmModule } from '@mikro-orm/nestjs';
import { MiddlewareConsumer, Module, NestModule, OnModuleInit } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { LoggerModule } from 'nestjs-pino';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthenticationModule } from './authentication/authentication.module';
import { CategoryModule } from './category/category.module';
import { CoinModule } from './coin/coin.module';
import MikroOrmConfig from './config/mikro-orm.config';
import { HealthModule } from './health/health.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { TaskModule } from './task/task.module';

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
    MikroOrmModule.forRoot(MikroOrmConfig),
    AuthenticationModule,
    HealthModule,
    CoinModule,
    CategoryModule,
    PortfolioModule,
    TaskModule
  ],
  controllers: [AppController],
  providers: [AppService]
})
export class AppModule implements NestModule, OnModuleInit {
  constructor(private readonly orm: MikroORM) {}

  async onModuleInit(): Promise<void> {
    // await this.orm.getMigrator().up();
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(MikroOrmMiddleware).forRoutes('*');
  }
}
