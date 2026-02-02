import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Pipeline } from './entities/pipeline.entity';
import { PipelineEventListener } from './listeners/pipeline-event.listener';
import { pipelineConfig } from './pipeline.config';
import { PipelineController } from './pipeline.controller';
import { PipelineProcessor } from './processors/pipeline.processor';
import { PipelineOrchestratorService } from './services/pipeline-orchestrator.service';
import { PipelineReportService } from './services/pipeline-report.service';

import { AuthenticationModule } from '../authentication/authentication.module';
import { ExchangeKey } from '../exchange/exchange-key/exchange-key.entity';
import { OptimizationModule } from '../optimization/optimization.module';
import { OrderModule } from '../order/order.module';
import { StrategyConfig } from '../strategy/entities/strategy-config.entity';

const PIPELINE_CONFIG = pipelineConfig();

@Module({
  imports: [
    ConfigModule.forFeature(pipelineConfig),
    TypeOrmModule.forFeature([Pipeline, StrategyConfig, ExchangeKey]),
    BullModule.registerQueue({ name: PIPELINE_CONFIG.queue }),
    EventEmitterModule.forRoot(),
    forwardRef(() => AuthenticationModule),
    forwardRef(() => OptimizationModule),
    forwardRef(() => OrderModule)
  ],
  controllers: [PipelineController],
  providers: [PipelineOrchestratorService, PipelineProcessor, PipelineEventListener, PipelineReportService],
  exports: [PipelineOrchestratorService]
})
export class PipelineModule {}
