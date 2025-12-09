import { BullModule } from '@nestjs/bullmq';
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DriftDetectionTask } from './drift-detection.task';
import { MarketRegimeTask } from './market-regime.task';
import { PerformanceCalcTask } from './performance-calc.task';
import { PromotionTask } from './promotion.task';
import { RiskMonitoringTask } from './risk-monitoring.task';
import { StrategyEvaluationTask } from './strategy-evaluation.task';
import { TaskSchedulerService } from './task-scheduler.service';

import { AlgorithmModule } from '../algorithm/algorithm.module';
import { AuditModule } from '../audit/audit.module';
import { CoinModule } from '../coin/coin.module';
import { MarketRegimeModule } from '../market-regime/market-regime.module';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { OrderModule } from '../order/order.module';
import { Risk } from '../risk/risk.entity';
import { ScoringModule } from '../scoring/scoring.module';
import { BacktestRun } from '../strategy/entities/backtest-run.entity';
import { Deployment } from '../strategy/entities/deployment.entity';
import { PerformanceMetric } from '../strategy/entities/performance-metric.entity';
import { StrategyConfig } from '../strategy/entities/strategy-config.entity';
import { StrategyModule } from '../strategy/strategy.module';

/**
 * TasksModule
 *
 * Central module for all scheduled background tasks.
 *
 * Tasks are scheduled using NestJS @Cron decorators and process
 * jobs via BullMQ queues for scalability.
 *
 * Scheduled Tasks:
 * - StrategyEvaluationTask: Every 6 hours - Evaluate strategies in testing status
 * - MarketRegimeTask: Every hour - Monitor market regime changes
 * - PromotionTask: Daily at 2 AM - Evaluate validated strategies for promotion
 * - RiskMonitoringTask: Every hour - Monitor active deployments for risk breaches
 * - DriftDetectionTask: Every 6 hours - Detect performance drift in deployed strategies
 * - PerformanceCalcTask: Daily at 1 AM - Calculate daily performance metrics
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([StrategyConfig, BacktestRun, Deployment, PerformanceMetric, Risk]),
    BullModule.registerQueue(
      { name: 'strategy-evaluation-queue' },
      { name: 'drift-detection-queue' },
      { name: 'regime-check-queue' }
    ),
    forwardRef(() => AlgorithmModule),
    forwardRef(() => CoinModule),
    forwardRef(() => OrderModule),
    forwardRef(() => StrategyModule),
    forwardRef(() => MarketRegimeModule),
    ScoringModule,
    AuditModule,
    MonitoringModule
  ],
  providers: [
    StrategyEvaluationTask,
    MarketRegimeTask,
    PromotionTask,
    RiskMonitoringTask,
    DriftDetectionTask,
    PerformanceCalcTask,
    TaskSchedulerService
  ],
  exports: [
    StrategyEvaluationTask,
    MarketRegimeTask,
    PromotionTask,
    RiskMonitoringTask,
    DriftDetectionTask,
    PerformanceCalcTask,
    TaskSchedulerService
  ]
})
export class TasksModule {}
