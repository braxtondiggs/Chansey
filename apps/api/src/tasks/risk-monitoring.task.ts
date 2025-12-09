import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { Queue } from 'bullmq';

import { DeploymentService } from '../strategy/deployment.service';
import { RiskManagementService } from '../strategy/risk/risk-management.service';

/**
 * RiskMonitoringTask
 *
 * Background job for continuous risk monitoring of deployed strategies.
 *
 * Runs hourly to check all active deployments for risk threshold breaches.
 * Automatically demotes strategies that exceed critical risk limits.
 *
 * Schedule: Every hour on the hour
 */
@Injectable()
export class RiskMonitoringTask {
  private readonly logger = new Logger(RiskMonitoringTask.name);

  constructor(
    @InjectQueue('drift-detection-queue')
    private readonly driftQueue: Queue,
    private readonly riskManagementService: RiskManagementService,
    private readonly deploymentService: DeploymentService
  ) {}

  /**
   * Schedule hourly risk monitoring
   *
   * Evaluates all active deployments for risk threshold breaches.
   */
  @Cron(CronExpression.EVERY_HOUR, {
    name: 'risk-monitoring',
    timeZone: 'UTC'
  })
  async scheduleRiskMonitoring() {
    this.logger.log('Starting hourly risk monitoring for active deployments');

    try {
      // Evaluate risks for all active deployments
      const evaluations = await this.riskManagementService.evaluateAllDeployments();

      // Summarize results
      const atRisk = evaluations.filter((e) => e.hasCriticalRisk);
      const demoted = evaluations.filter((e) => e.shouldDemote);

      this.logger.log(
        `Risk monitoring complete: ${evaluations.length} deployments evaluated, ` +
          `${atRisk.length} at risk, ${demoted.length} demoted`
      );

      // Log critical risks for alerting
      if (atRisk.length > 0) {
        this.logger.warn(`CRITICAL RISKS DETECTED in ${atRisk.length} deployments:`);
        for (const riskEval of atRisk) {
          this.logger.warn(`  - Deployment ${riskEval.deploymentId}: ${riskEval.summary}`);
          this.logger.warn(`    Failed checks: ${riskEval.failedChecks.join(', ')}`);
        }
      }

      // Queue drift detection for strategies showing warning signs
      const warningDeployments = evaluations.filter(
        (e) => !e.shouldDemote && e.checksFailed > 0 && e.hasCriticalRisk === false
      );

      for (const riskEval of warningDeployments) {
        await this.queueDriftDetection(riskEval.deploymentId);
      }

      if (warningDeployments.length > 0) {
        this.logger.log(`Queued drift detection for ${warningDeployments.length} deployments with warnings`);
      }
    } catch (error) {
      this.logger.error('Failed to complete risk monitoring:', error);
    }
  }

  /**
   * Queue drift detection for a deployment showing warning signs
   */
  private async queueDriftDetection(deploymentId: string): Promise<void> {
    await this.driftQueue.add(
      'drift-detection',
      { deploymentId },
      {
        priority: 2, // Medium priority
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000
        }
      }
    );
  }

  /**
   * Emergency risk check (on-demand)
   *
   * Used for immediate risk evaluation after significant events (large loss, etc.)
   */
  async performEmergencyRiskCheck(deploymentId: string): Promise<any> {
    this.logger.warn(`EMERGENCY risk check triggered for deployment ${deploymentId}`);

    try {
      const evaluation = await this.riskManagementService.evaluateRisks(deploymentId, 'emergency');

      if (evaluation.hasCriticalRisk) {
        this.logger.error(`EMERGENCY: Critical risk detected in deployment ${deploymentId}: ${evaluation.summary}`);

        // Send high-priority alert
        // TODO: Integrate with notification service when available
      }

      return evaluation;
    } catch (error) {
      this.logger.error(`Emergency risk check failed for deployment ${deploymentId}:`, error);
      throw error;
    }
  }

  /**
   * Get current risk status summary
   */
  async getRiskStatusSummary(): Promise<any> {
    const activeDeployments = await this.deploymentService.getActiveDeployments();
    const deploymentsAtRisk = await this.deploymentService.getDeploymentsAtRisk();

    return {
      totalActive: activeDeployments.length,
      atRisk: deploymentsAtRisk.length,
      riskPercentage: activeDeployments.length > 0 ? (deploymentsAtRisk.length / activeDeployments.length) * 100 : 0,
      timestamp: new Date()
    };
  }
}
