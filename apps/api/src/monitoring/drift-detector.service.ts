import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { AuditEventType } from '@chansey/api-interfaces';

import { DrawdownDriftDetector } from './drift/drawdown-drift.detector';
import { ReturnDriftDetector } from './drift/return-drift.detector';
import { SharpeDriftDetector } from './drift/sharpe-drift.detector';
import { VolatilityDriftDetector } from './drift/volatility-drift.detector';
import { WinRateDriftDetector } from './drift/winrate-drift.detector';
import { DriftAlert } from './entities/drift-alert.entity';
import { MonitoringService } from './monitoring.service';

import { AuditService } from '../audit/audit.service';
import { Deployment } from '../strategy/entities/deployment.entity';
import { PerformanceMetric } from '../strategy/entities/performance-metric.entity';

// Import drift detectors

/**
 * DriftDetectorService
 *
 * Orchestrates drift detection across multiple metrics for deployed strategies.
 *
 * Drift Types:
 * - Sharpe Ratio: Degradation in risk-adjusted returns
 * - Returns: Lower profitability than expected
 * - Drawdown: Larger losses than backtest
 * - Win Rate: Lower success rate
 * - Volatility: Higher risk than expected
 *
 * Workflow:
 * 1. Compare live metrics to backtest expectations
 * 2. Calculate deviation percentages
 * 3. Trigger alerts when thresholds exceeded
 * 4. Log all detections to audit trail
 * 5. Update deployment drift metrics
 */
@Injectable()
export class DriftDetectorService {
  private readonly logger = new Logger(DriftDetectorService.name);

  constructor(
    @InjectRepository(DriftAlert)
    private readonly driftAlertRepo: Repository<DriftAlert>,
    @InjectRepository(Deployment)
    private readonly deploymentRepo: Repository<Deployment>,
    private readonly monitoringService: MonitoringService,
    private readonly auditService: AuditService,
    // Inject drift detectors
    private readonly sharpeDriftDetector: SharpeDriftDetector,
    private readonly returnDriftDetector: ReturnDriftDetector,
    private readonly drawdownDriftDetector: DrawdownDriftDetector,
    private readonly winRateDriftDetector: WinRateDriftDetector,
    private readonly volatilityDriftDetector: VolatilityDriftDetector
  ) {}

  /**
   * Detect drift for a deployment across all metrics
   */
  async detectDrift(deploymentId: string): Promise<DriftAlert[]> {
    this.logger.log(`Starting drift detection for deployment ${deploymentId}`);

    const deployment = await this.deploymentRepo.findOne({
      where: { id: deploymentId },
      relations: ['strategyConfig']
    });

    if (!deployment || !deployment.isActive) {
      this.logger.warn(`Deployment ${deploymentId} is not active, skipping drift detection`);
      return [];
    }

    const latestMetric = await this.monitoringService.getLatestMetric(deploymentId);

    if (!latestMetric) {
      this.logger.warn(`No performance metrics available for deployment ${deploymentId}`);
      return [];
    }

    // Run all drift detectors
    const alerts: DriftAlert[] = [];

    const detectors = [
      { name: 'sharpe', detector: this.sharpeDriftDetector },
      { name: 'return', detector: this.returnDriftDetector },
      { name: 'drawdown', detector: this.drawdownDriftDetector },
      { name: 'winRate', detector: this.winRateDriftDetector },
      { name: 'volatility', detector: this.volatilityDriftDetector }
    ];

    for (const { name, detector } of detectors) {
      try {
        const alert = await detector.detect(deployment, latestMetric);

        if (alert) {
          const savedAlert = await this.driftAlertRepo.save(alert);
          alerts.push(savedAlert);

          this.logger.warn(`${name} drift detected for deployment ${deploymentId}: ${alert.message}`);
        }
      } catch (error) {
        this.logger.error(`Error running ${name} drift detector for deployment ${deploymentId}:`, error);
      }
    }

    // Update deployment with drift status
    if (alerts.length > 0) {
      await this.updateDeploymentDriftStatus(deployment, alerts);

      // Log to audit trail
      await this.auditService.createAuditLog({
        eventType: AuditEventType.DRIFT_DETECTED,
        entityType: 'Deployment',
        entityId: deploymentId,
        userId: 'system',
        beforeState: { driftAlertCount: deployment.driftAlertCount },
        afterState: { driftAlertCount: deployment.driftAlertCount + alerts.length },
        metadata: {
          newAlerts: alerts.length,
          driftTypes: alerts.map((a) => a.driftType),
          severities: alerts.map((a) => a.severity)
        }
      });
    }

    this.logger.log(`Drift detection complete for deployment ${deploymentId}: ${alerts.length} alerts generated`);

    return alerts;
  }

  /**
   * Get active drift alerts for a deployment
   */
  async getActiveDriftAlerts(deploymentId: string): Promise<DriftAlert[]> {
    return await this.driftAlertRepo.find({
      where: { deploymentId, resolved: false },
      order: { createdAt: 'DESC' }
    });
  }

  /**
   * Get all drift alerts for a deployment
   */
  async getAllDriftAlerts(deploymentId: string): Promise<DriftAlert[]> {
    return await this.driftAlertRepo.find({
      where: { deploymentId },
      order: { createdAt: 'DESC' }
    });
  }

  /**
   * Resolve a drift alert
   */
  async resolveDriftAlert(alertId: string, resolutionType: string, notes?: string): Promise<DriftAlert> {
    const alert = await this.driftAlertRepo.findOne({ where: { id: alertId } });

    if (!alert) {
      throw new Error(`Drift alert ${alertId} not found`);
    }

    alert.resolved = true;
    alert.resolvedAt = new Date();
    alert.resolutionType = resolutionType;
    alert.resolutionNotes = notes || null;

    return await this.driftAlertRepo.save(alert);
  }

  /**
   * Update deployment with latest drift information
   */
  private async updateDeploymentDriftStatus(deployment: Deployment, alerts: DriftAlert[]): Promise<void> {
    const criticalAlerts = alerts.filter((a) => a.isCritical);

    deployment.driftAlertCount = deployment.driftAlertCount + alerts.length;
    deployment.lastDriftDetectedAt = new Date();
    deployment.driftMetrics = {
      totalAlerts: deployment.driftAlertCount + alerts.length,
      criticalAlerts: criticalAlerts.length,
      latestAlerts: alerts.map((a) => ({
        type: a.driftType,
        severity: a.severity,
        deviation: Number(a.deviationPercent),
        message: a.message
      }))
    };

    await this.deploymentRepo.save(deployment);
  }

  /**
   * Get drift summary for a deployment
   */
  async getDriftSummary(deploymentId: string): Promise<any> {
    const activeAlerts = await this.getActiveDriftAlerts(deploymentId);
    const allAlerts = await this.getAllDriftAlerts(deploymentId);

    const criticalAlerts = activeAlerts.filter((a) => a.severity === 'critical');
    const highAlerts = activeAlerts.filter((a) => a.severity === 'high');
    const mediumAlerts = activeAlerts.filter((a) => a.severity === 'medium');
    const lowAlerts = activeAlerts.filter((a) => a.severity === 'low');

    return {
      deploymentId,
      totalAlerts: allAlerts.length,
      activeAlerts: activeAlerts.length,
      resolvedAlerts: allAlerts.length - activeAlerts.length,
      breakdown: {
        critical: criticalAlerts.length,
        high: highAlerts.length,
        medium: mediumAlerts.length,
        low: lowAlerts.length
      },
      driftTypes: this.groupAlertsByType(activeAlerts),
      oldestActiveAlert: activeAlerts.length > 0 ? activeAlerts[activeAlerts.length - 1].createdAt : null,
      newestActiveAlert: activeAlerts.length > 0 ? activeAlerts[0].createdAt : null
    };
  }

  /**
   * Helper: Group alerts by drift type
   */
  private groupAlertsByType(alerts: DriftAlert[]): Record<string, number> {
    return alerts.reduce(
      (acc, alert) => {
        acc[alert.driftType] = (acc[alert.driftType] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
  }
}
