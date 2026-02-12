import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository, In } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import { DriftDetectorService } from '../monitoring/drift-detector.service';
import { Deployment } from '../strategy/entities/deployment.entity';

/**
 * Drift Detection Scheduled Task (T097)
 *
 * Runs periodically to detect performance drift in deployed strategies
 *
 * Schedule: Every 6 hours
 * Purpose: Early detection of strategy performance degradation
 *
 * Process:
 * 1. Find all active deployments
 * 2. Run drift detection on each deployment
 * 3. Create drift alerts for significant degradation
 * 4. Log drift events to audit trail
 *
 * Integrates with:
 * - DriftDetectorService for multi-dimensional drift checks
 * - AlertService for notifications
 * - AuditService for compliance logging
 */
@Injectable()
export class DriftDetectionTask {
  private readonly logger = new Logger(DriftDetectionTask.name);

  constructor(
    @InjectRepository(Deployment)
    private readonly deploymentRepo: Repository<Deployment>,
    private readonly driftDetectorService: DriftDetectorService,
    private readonly auditService: AuditService
  ) {}

  /**
   * Execute drift detection for all active deployments
   *
   * Called on cron schedule
   */
  async execute(): Promise<void> {
    this.logger.log('Starting drift detection task');

    try {
      // Get all active and paused deployments
      const deployments = await this.deploymentRepo.find({
        where: {
          status: In(['active', 'paused'])
        },
        relations: ['strategyConfig']
      });

      this.logger.log(`Found ${deployments.length} deployments to check for drift`);

      let driftDetectedCount = 0;
      let errorsCount = 0;

      // Check each deployment for drift
      for (const deployment of deployments) {
        try {
          const driftAlerts = await this.driftDetectorService.detectDrift(deployment.id);

          if (driftAlerts.length > 0) {
            driftDetectedCount++;

            this.logger.warn(
              `Drift detected for deployment ${deployment.id} (${deployment.strategyConfig.name}): ` +
                `${driftAlerts.length} alert(s) - ${driftAlerts.map((a) => a.driftType).join(', ')}`
            );

            // Log each drift alert to audit trail
            for (const alert of driftAlerts) {
              await this.auditService.logDriftDetection(deployment.id, alert.id, alert.driftType, alert.severity, {
                expectedValue: alert.expectedValue,
                actualValue: alert.actualValue,
                deviationPercent: Number(alert.deviationPercent),
                failedChecks: [alert.driftType]
              });
            }
          } else {
            this.logger.debug(`No drift detected for deployment ${deployment.id} (${deployment.strategyConfig.name})`);
          }
        } catch (error) {
          errorsCount++;
          this.logger.error(`Error checking drift for deployment ${deployment.id}: ${error.message}`, error.stack);
        }
      }

      this.logger.log(
        `Drift detection task completed: ${deployments.length} checked, ` +
          `${driftDetectedCount} with drift, ${errorsCount} errors`
      );
    } catch (error) {
      this.logger.error(`Drift detection task failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Execute drift detection for a specific deployment
   * Useful for on-demand checks
   */
  async executeForDeployment(deploymentId: string): Promise<void> {
    this.logger.log(`Running drift detection for deployment ${deploymentId}`);

    try {
      const driftAlerts = await this.driftDetectorService.detectDrift(deploymentId);

      if (driftAlerts.length > 0) {
        this.logger.warn(
          `Drift detected for deployment ${deploymentId}: ${driftAlerts.length} alert(s) - ` +
            `${driftAlerts.map((a) => a.driftType).join(', ')}`
        );

        // Log each drift alert to audit trail
        for (const alert of driftAlerts) {
          await this.auditService.logDriftDetection(deploymentId, alert.id, alert.driftType, alert.severity, {
            expectedValue: alert.expectedValue,
            actualValue: alert.actualValue,
            deviationPercent: Number(alert.deviationPercent),
            failedChecks: [alert.driftType]
          });
        }
      } else {
        this.logger.log(`No drift detected for deployment ${deploymentId}`);
      }
    } catch (error) {
      this.logger.error(`Error checking drift for deployment ${deploymentId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get task metadata for monitoring
   */
  getMetadata(): {
    name: string;
    description: string;
    schedule: string;
    enabled: boolean;
  } {
    return {
      name: 'drift-detection',
      description: 'Detect performance drift in deployed strategies',
      schedule: '0 */6 * * *', // Every 6 hours
      enabled: true
    };
  }
}
