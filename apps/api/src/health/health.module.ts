import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule,
    TerminusModule.forRoot({
      errorLogStyle: 'pretty'
    })
  ],
  controllers: [HealthController]
})
export class HealthModule {}
