import { Module } from '@nestjs/common';
import { HealthModule } from '../health/health.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { OrmModule } from '../orm.module';

@Module({
  imports: [
    HealthModule,
    OrmModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
