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
import { PipelineEtaService } from './services/pipeline-eta.service';
import { PipelineEventHandlerService } from './services/pipeline-event-handler.service';
import { PipelineOrchestratorService } from './services/pipeline-orchestrator.service';
import { PipelineProgressionService } from './services/pipeline-progression.service';
import { PipelineReportService } from './services/pipeline-report.service';
import { PipelineStageExecutionService } from './services/pipeline-stage-execution.service';
import { UserPipelineController } from './user-pipeline.controller';

import { AlgorithmModule } from '../algorithm/algorithm.module';
import { AuthenticationModule } from '../authentication/authentication.module';
import { CoinSelectionModule } from '../coin-selection/coin-selection.module';
import { ExchangeSelectionModule } from '../exchange/exchange-selection/exchange-selection.module';
import { MarketRegimeModule } from '../market-regime/market-regime.module';
import { OptimizationModule } from '../optimization/optimization.module';
import { OrderModule } from '../order/order.module';
import { PaperTradingSession } from '../order/paper-trading/entities/paper-trading-session.entity';
import { PaperTradingModule } from '../order/paper-trading/paper-trading.module';
import { ScoringModule } from '../scoring/scoring.module';
import { StrategyConfig } from '../strategy/entities/strategy-config.entity';
import { TasksModule } from '../tasks/tasks.module';

const PIPELINE_CONFIG = pipelineConfig();

@Module({
  imports: [
    ConfigModule.forFeature(pipelineConfig),
    TypeOrmModule.forFeature([Pipeline, StrategyConfig, PaperTradingSession]),
    BullModule.registerQueue({ name: PIPELINE_CONFIG.queue }),
    EventEmitterModule.forRoot(),
    forwardRef(() => AlgorithmModule),
    forwardRef(() => AuthenticationModule),
    forwardRef(() => OptimizationModule),
    forwardRef(() => OrderModule),
    forwardRef(() => PaperTradingModule),
    forwardRef(() => ScoringModule),
    forwardRef(() => MarketRegimeModule),
    forwardRef(() => CoinSelectionModule),
    forwardRef(() => TasksModule),
    ExchangeSelectionModule
  ],
  controllers: [PipelineController, UserPipelineController],
  providers: [
    PipelineOrchestratorService,
    PipelineStageExecutionService,
    PipelineProgressionService,
    PipelineEventHandlerService,
    PipelineProcessor,
    PipelineEventListener,
    PipelineReportService,
    PipelineEtaService
  ],
  exports: [PipelineOrchestratorService, PipelineEtaService]
})
export class PipelineModule {}
