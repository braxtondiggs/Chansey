import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { AuditEventType } from '@chansey/api-interfaces';

import { ConsecutiveLossesCheck } from './consecutive-losses.check';
import { DailyLossLimitCheck } from './daily-loss-limit.check';
import { DrawdownBreachCheck } from './drawdown-breach.check';
import { IRiskCheck, RiskCheckResult, RiskEvaluation } from './risk-check.interface';
import { SharpeDegradationCheck } from './sharpe-degradation.check';
import { VolatilitySpikeCheck } from './volatility-spike.check';

import { AuditService } from '../../audit/audit.service';
import { toErrorInfo } from '../../shared/error.util';
import { DeploymentService } from '../deployment.service';
import { Deployment } from '../entities/deployment.entity';
import { PerformanceMetric } from '../entities/performance-metric.entity';

// Import all risk check implementations

/**
 * RiskManagementService
 *
 * Orchestrates evaluation of all risk checks for deployed strategies.
 * Monitors risk metrics and automatically demotes strategies that breach
 * critical risk thresholds.
 *
 * Risk checks are evaluated:
 * - Periodically (hourly via background job)
 * - On-demand (manual trigger)
 * - After significant events (large loss, etc.)
 *
 * All risk evaluations are logged to the audit trail.
 */
@Injectable()
export class RiskManagementService {
  private readonly logger = new Logger(RiskManagementService.name);
  private readonly checks: IRiskCheck[];

  constructor(
    @InjectRepository(Deployment)
    private readonly deploymentRepo: Repository<Deployment>,
    @InjectRepository(PerformanceMetric)
    private readonly performanceMetricRepo: Repository<PerformanceMetric>,
    private readonly deploymentService: DeploymentService,
    private readonly auditService: AuditService,
    // Inject all risk check implementations
    private readonly drawdownBreachCheck: DrawdownBreachCheck,
    private readonly dailyLossLimitCheck: DailyLossLimitCheck,
    private readonly consecutiveLossesCheck: ConsecutiveLossesCheck,
    private readonly volatilitySpikeCheck: VolatilitySpikeCheck,
    private readonly sharpeDegradationCheck: SharpeDegradationCheck
  ) {
    // Register all checks in priority order
    this.checks = [
      this.drawdownBreachCheck,
      this.dailyLossLimitCheck,
      this.consecutiveLossesCheck,
      this.volatilitySpikeCheck,
      this.sharpeDegradationCheck
    ].sort((a, b) => a.priority - b.priority);
  }

  /**
   * Evaluate all risk checks for a deployment
   */
  async evaluateRisks(deploymentId: string, userId?: string): Promise<RiskEvaluation> {
    this.logger.log(`Evaluating risk checks for deployment ${deploymentId}`);

    const deployment = await this.deploymentService.findOne(deploymentId);

    if (!deployment.isActive) {
      this.logger.warn(`Deployment ${deploymentId} is not active, skipping risk evaluation`);
      return this.createEmptyEvaluation(deploymentId);
    }

    // Load performance metrics
    const latestMetric = await this.deploymentService.getLatestPerformanceMetric(deploymentId);
    const historicalMetrics = await this.loadHistoricalMetrics(deploymentId, 30); // Last 30 days

    // Evaluate all checks
    const checkResults: RiskCheckResult[] = [];

    for (const check of this.checks) {
      try {
        const result = await check.evaluate(deployment, latestMetric, historicalMetrics);
        checkResults.push(result);

        this.logger.debug(`Risk check ${check.name}: ${result.passed ? 'PASS' : 'FAIL'} - ${result.message}`);
      } catch (error: unknown) {
        this.logger.error(`Error evaluating risk check ${check.name}:`, error);
        const err = toErrorInfo(error);
        checkResults.push({
          checkName: check.name,
          passed: false,
          actualValue: 'ERROR',
          threshold: 'N/A',
          severity: 'critical',
          message: `Check evaluation failed: ${err.message}`
        });
      }
    }

    // Calculate overall evaluation
    const evaluation = this.calculateEvaluation(deploymentId, checkResults);

    // Log to audit trail
    await this.auditService.createAuditLog({
      eventType: AuditEventType.RISK_EVALUATION,
      entityType: 'Deployment',
      entityId: deploymentId,
      userId,
      beforeState: undefined,
      afterState: {
        hasCriticalRisk: evaluation.hasCriticalRisk,
        shouldDemote: evaluation.shouldDemote,
        checksFailed: evaluation.checksFailed,
        failedChecks: evaluation.failedChecks
      },
      metadata: {
        checkResults,
        latestMetricDate: latestMetric?.date,
        daysLive: deployment.daysLive
      }
    });

    // Auto-demote if critical risks detected
    if (evaluation.shouldDemote) {
      await this.handleAutoDemotion(deployment, evaluation);
    }

    this.logger.log(
      `Risk evaluation for ${deploymentId}: ${evaluation.hasCriticalRisk ? 'RISK DETECTED' : 'HEALTHY'} ` +
        `(${evaluation.checksPassed}/${evaluation.totalChecks} passed)`
    );

    return evaluation;
  }

  /**
   * Evaluate risks for all active deployments
   */
  async evaluateAllDeployments(): Promise<RiskEvaluation[]> {
    const activeDeployments = await this.deploymentService.getActiveDeployments();

    this.logger.log(`Evaluating risk checks for ${activeDeployments.length} active deployments`);

    const evaluations: RiskEvaluation[] = [];

    for (const deployment of activeDeployments) {
      try {
        const evaluation = await this.evaluateRisks(deployment.id);
        evaluations.push(evaluation);
      } catch (error: unknown) {
        this.logger.error(`Failed to evaluate risks for deployment ${deployment.id}:`, error);
      }
    }

    const atRisk = evaluations.filter((e) => e.hasCriticalRisk).length;
    const demoted = evaluations.filter((e) => e.shouldDemote).length;

    this.logger.log(`Risk evaluation complete: ${atRisk} deployments at risk, ${demoted} marked for demotion`);

    return evaluations;
  }

  /**
   * Calculate overall evaluation from check results
   */
  private calculateEvaluation(deploymentId: string, checkResults: RiskCheckResult[]): RiskEvaluation {
    const totalChecks = checkResults.length;
    const checksPassed = checkResults.filter((r) => r.passed).length;
    const checksFailed = totalChecks - checksPassed;

    const failedChecks = checkResults.filter((r) => !r.passed).map((r) => r.checkName);

    const criticalFailures = checkResults.filter((r) => !r.passed && r.severity === 'critical');

    const hasCriticalRisk = criticalFailures.length > 0;

    // Determine if auto-demotion should occur
    const autoDemoteChecks = this.checks.filter((c) => c.autoDemote);
    const autoDemoteFailures = checkResults.filter(
      (r) => !r.passed && r.severity === 'critical' && autoDemoteChecks.some((c) => c.name === r.checkName)
    );
    const shouldDemote = autoDemoteFailures.length > 0;

    // Collect recommended actions
    const recommendedActions = checkResults
      .filter((r) => !r.passed && r.recommendedAction)
      .map((r) => r.recommendedAction as string);

    let summary: string;
    if (checksFailed === 0) {
      summary = `All ${totalChecks} risk checks passed. No risk detected.`;
    } else if (hasCriticalRisk) {
      summary = `${criticalFailures.length} critical risk(s) detected. Immediate action required.`;
    } else {
      summary = `${checksFailed} warning(s) detected. Monitor closely.`;
    }

    return {
      deploymentId,
      evaluatedAt: new Date(),
      hasCriticalRisk,
      shouldDemote,
      checkResults,
      totalChecks,
      checksPassed,
      checksFailed,
      failedChecks,
      summary,
      recommendedActions
    };
  }

  /**
   * Handle automatic demotion of a deployment
   */
  private async handleAutoDemotion(deployment: Deployment, evaluation: RiskEvaluation): Promise<void> {
    const criticalChecks = evaluation.checkResults
      .filter((r) => !r.passed && r.severity === 'critical')
      .map((r) => r.checkName)
      .join(', ');

    const reason = `Automatic demotion due to critical risk: ${criticalChecks}`;

    this.logger.error(`AUTO-DEMOTING deployment ${deployment.id}: ${reason}`);

    await this.deploymentService.demoteDeployment(deployment.id, reason, {
      riskEvaluation: evaluation,
      autoDemotion: true,
      criticalChecks,
      evaluatedAt: evaluation.evaluatedAt
    });
  }

  /**
   * Load historical metrics for a deployment
   */
  private async loadHistoricalMetrics(deploymentId: string, days: number): Promise<PerformanceMetric[]> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const metrics = await this.performanceMetricRepo
      .createQueryBuilder('metric')
      .where('metric.deploymentId = :deploymentId', { deploymentId })
      .andWhere('metric.date >= :startDate', { startDate: startDate.toISOString().split('T')[0] })
      .andWhere('metric.date <= :endDate', { endDate: endDate.toISOString().split('T')[0] })
      .orderBy('metric.date', 'ASC')
      .getMany();

    return metrics;
  }

  /**
   * Create empty evaluation (for inactive deployments)
   */
  private createEmptyEvaluation(deploymentId: string): RiskEvaluation {
    return {
      deploymentId,
      evaluatedAt: new Date(),
      hasCriticalRisk: false,
      shouldDemote: false,
      checkResults: [],
      totalChecks: 0,
      checksPassed: 0,
      checksFailed: 0,
      failedChecks: [],
      summary: 'Deployment is not active',
      recommendedActions: []
    };
  }

  /**
   * Get all registered risk checks
   */
  getChecks(): IRiskCheck[] {
    return [...this.checks];
  }

  /**
   * Get check by name
   */
  getCheck(name: string): IRiskCheck | undefined {
    return this.checks.find((c) => c.name === name);
  }

  /**
   * Get critical checks only (auto-demote)
   */
  getCriticalChecks(): IRiskCheck[] {
    return this.checks.filter((c) => c.autoDemote);
  }
}
