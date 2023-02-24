import { join } from 'path';

import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { LoggerModule } from 'nestjs-pino';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TasksService } from './task.service';
import { HealthModule } from '../health/health.module';
import { OrmModule } from '../orm.module';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        transport: {
          target: 'pino-pretty',
          options: {
            singleLine: true
          },
        },
      },
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '../dist/client'),
      exclude: ['/api/(.*)']
    }),
    HealthModule,
    OrmModule
  ],
  controllers: [AppController],
  providers: [AppService, TasksService],
})
export class AppModule { }
