import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OptimizationResult } from './entities/optimization-result.entity';
import { OptimizationRun } from './entities/optimization-run.entity';
import { OptimizationController } from './optimization.controller';
import { OptimizationProcessor } from './processors/optimization.processor';
import { GridSearchService } from './services/grid-search.service';
import { OptimizationOrchestratorService } from './services/optimization-orchestrator.service';
import { OptimizationRecoveryService } from './services/optimization-recovery.service';

import { Coin } from '../coin/coin.entity';
import { OHLCModule } from '../ohlc/ohlc.module';
import { OrderModule } from '../order/order.module';
import { ScoringModule } from '../scoring/scoring.module';
import { StrategyConfig } from '../strategy/entities/strategy-config.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([OptimizationRun, OptimizationResult, StrategyConfig, Coin]),
    BullModule.registerQueue({ name: 'optimization' }),
    ScoringModule,
    forwardRef(() => OrderModule),
    forwardRef(() => OHLCModule)
  ],
  controllers: [OptimizationController],
  providers: [GridSearchService, OptimizationOrchestratorService, OptimizationProcessor, OptimizationRecoveryService],
  exports: [GridSearchService, OptimizationOrchestratorService]
})
export class OptimizationModule {}
