import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AlertService } from './alert.service';
import { DrawdownDriftDetector } from './drift/drawdown-drift.detector';
import { ReturnDriftDetector } from './drift/return-drift.detector';
import { SharpeDriftDetector } from './drift/sharpe-drift.detector';
import { VolatilityDriftDetector } from './drift/volatility-drift.detector';
import { WinRateDriftDetector } from './drift/winrate-drift.detector';
import { DriftDetectorService } from './drift-detector.service';
import { DriftAlert } from './entities/drift-alert.entity';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';

import { AuditModule } from '../audit/audit.module';
import { Deployment } from '../strategy/entities/deployment.entity';
import { PerformanceMetric } from '../strategy/entities/performance-metric.entity';
import { StrategyModule } from '../strategy/strategy.module';

/**
 * MonitoringModule
 *
 * Handles performance monitoring and drift detection for deployed strategies.
 *
 * Features:
 * - Real-time performance metric tracking
 * - Drift detection across multiple metrics (Sharpe, returns, drawdown, win rate, volatility)
 * - Alert generation for performance degradation
 * - Historical performance analysis
 *
 * Integration:
 * - Uses PerformanceMetric entity from StrategyModule
 * - Creates DriftAlert entities for detected drift
 * - Integrates with RiskManagementService for auto-demotion triggers
 */
@Module({
  imports: [TypeOrmModule.forFeature([Deployment, PerformanceMetric, DriftAlert]), StrategyModule, AuditModule],
  providers: [
    MonitoringService,
    DriftDetectorService,
    AlertService,
    SharpeDriftDetector,
    ReturnDriftDetector,
    DrawdownDriftDetector,
    WinRateDriftDetector,
    VolatilityDriftDetector
  ],
  controllers: [MonitoringController],
  exports: [MonitoringService, DriftDetectorService, AlertService]
})
export class MonitoringModule {}
