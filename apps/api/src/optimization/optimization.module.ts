import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OptimizationResult } from './entities/optimization-result.entity';
import { OptimizationRunSummary } from './entities/optimization-run-summary.entity';
import { OptimizationRun } from './entities/optimization-run.entity';
import { optimizationConfig } from './optimization.config';
import { OptimizationProcessor } from './processors/optimization.processor';
import { GridSearchService } from './services/grid-search.service';
import { OptimizationEvaluationService } from './services/optimization-evaluation.service';
import { OptimizationOrchestratorService } from './services/optimization-orchestrator.service';
import { OptimizationQueryService } from './services/optimization-query.service';
import { OptimizationRecoveryService } from './services/optimization-recovery.service';
import { OptimizationRunSummaryService } from './services/optimization-run-summary.service';
import {
  AdaptiveSearchStrategy,
  GridSearchStrategy,
  RandomSearchStrategy,
  SearchStrategyResolver
} from './services/search-strategies';

import { AlgorithmModule } from '../algorithm/algorithm.module';
import { Coin } from '../coin/coin.entity';
import { OHLCModule } from '../ohlc/ohlc.module';
import { OrderModule } from '../order/order.module';
import { ScoringModule } from '../scoring/scoring.module';
import { StrategyConfig } from '../strategy/entities/strategy-config.entity';

@Module({
  imports: [
    ConfigModule.forFeature(optimizationConfig),
    TypeOrmModule.forFeature([OptimizationRun, OptimizationResult, OptimizationRunSummary, StrategyConfig, Coin]),
    BullModule.registerQueue({ name: 'optimization' }),
    ScoringModule,
    forwardRef(() => OrderModule),
    forwardRef(() => OHLCModule),
    forwardRef(() => AlgorithmModule)
  ],
  providers: [
    GridSearchService,
    OptimizationEvaluationService,
    OptimizationOrchestratorService,
    OptimizationQueryService,
    OptimizationProcessor,
    OptimizationRecoveryService,
    OptimizationRunSummaryService,
    GridSearchStrategy,
    RandomSearchStrategy,
    AdaptiveSearchStrategy,
    SearchStrategyResolver
  ],
  exports: [GridSearchService, OptimizationOrchestratorService, OptimizationRunSummaryService]
})
export class OptimizationModule {}
