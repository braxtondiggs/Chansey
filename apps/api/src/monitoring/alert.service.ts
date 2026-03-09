import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { AuditEventType } from '@chansey/api-interfaces';

import { DriftAlert } from './entities/drift-alert.entity';

import { AuditService } from '../audit/audit.service';
import { NOTIFICATION_EVENTS } from '../notification/interfaces/notification-events.interface';
import { Deployment } from '../strategy/entities/deployment.entity';

/**
 * AlertService
 *
 * Manages notifications and alerts for drift detection and performance issues.
 *
 * Features:
 * - Generate formatted alert messages
 * - Send notifications (email, webhook, etc.) - TODO: Integrate notification provider
 * - Track alert history
 * - Manage alert escalation
 *
 * Currently logs alerts - notification integration can be added later
 * (e.g., SendGrid, AWS SES, Slack webhooks, etc.)
 */
@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);

  constructor(
    @InjectRepository(DriftAlert)
    private readonly driftAlertRepo: Repository<DriftAlert>,
    @InjectRepository(Deployment)
    private readonly deploymentRepo: Repository<Deployment>,
    private readonly auditService: AuditService,
    private readonly eventEmitter: EventEmitter2
  ) {}

  /**
   * Send drift alert notification
   */
  async sendDriftAlert(alert: DriftAlert): Promise<void> {
    const deployment = await this.deploymentRepo.findOne({
      where: { id: alert.deploymentId },
      relations: ['strategyConfig', 'strategyConfig.creator']
    });

    if (!deployment) {
      this.logger.error(`Cannot send alert - deployment ${alert.deploymentId} not found`);
      return;
    }

    const message = this.formatDriftAlertMessage(alert, deployment);

    // Log alert (in production, this would send email/webhook/etc.)
    this.logger.warn(`DRIFT ALERT [${alert.severity.toUpperCase()}]: ${message}`);

    // Log to audit trail
    await this.auditService.createAuditLog({
      eventType: AuditEventType.ALERT_SENT,
      entityType: 'DriftAlert',
      entityId: alert.id,
      beforeState: undefined,
      afterState: {
        alertType: 'drift',
        driftType: alert.driftType,
        severity: alert.severity,
        deploymentId: alert.deploymentId
      },
      metadata: {
        message,
        strategyName: deployment.strategyConfig?.name
      }
    });

    // Emit drift alert notification to the strategy owner
    const userId = deployment.strategyConfig?.creator?.id;
    if (userId) {
      this.eventEmitter.emit(NOTIFICATION_EVENTS.DRIFT_ALERT, {
        userId,
        driftType: alert.driftType,
        severity: alert.severity,
        message: alert.message,
        strategyName: deployment.strategyConfig?.name || 'Unknown',
        deploymentId: deployment.id,
        deviationPercent: Number(alert.deviationPercent)
      });
    }
  }

  /**
   * Send batch of alerts (for daily summaries)
   */
  async sendAlertSummary(alerts: DriftAlert[]): Promise<void> {
    if (alerts.length === 0) {
      return;
    }

    const criticalAlerts = alerts.filter((a) => a.severity === 'critical');
    const highAlerts = alerts.filter((a) => a.severity === 'high');

    const summary = this.formatAlertSummary(alerts);

    this.logger.warn(
      `ALERT SUMMARY: ${alerts.length} total alerts (${criticalAlerts.length} critical, ${highAlerts.length} high)`
    );
    this.logger.warn(summary);

    // Emit daily summary notifications per affected deployment owner
    const deploymentIds = [...new Set(alerts.map((a) => a.deploymentId))];
    for (const deploymentId of deploymentIds) {
      const deployment = await this.deploymentRepo.findOne({
        where: { id: deploymentId },
        relations: ['strategyConfig', 'strategyConfig.creator']
      });
      const userId = deployment?.strategyConfig?.creator?.id;
      if (userId) {
        const userAlerts = alerts.filter((a) => a.deploymentId === deploymentId);
        this.eventEmitter.emit(NOTIFICATION_EVENTS.DAILY_SUMMARY, {
          userId,
          totalTrades: 0,
          totalAlerts: userAlerts.length,
          criticalAlerts: userAlerts.filter((a) => a.severity === 'critical').length
        });
      }
    }
  }

  /**
   * Format drift alert message for notifications
   */
  private formatDriftAlertMessage(alert: DriftAlert, deployment: Deployment): string {
    const strategyName = deployment.strategyConfig?.name || 'Unknown Strategy';
    const severityEmoji = {
      critical: '🚨',
      high: '⚠️',
      medium: '⚡',
      low: 'ℹ️'
    }[alert.severity];

    return `
${severityEmoji} DRIFT ALERT - ${alert.severity.toUpperCase()}

Strategy: ${strategyName}
Deployment ID: ${deployment.id}
Drift Type: ${alert.driftType.replace('_', ' ').toUpperCase()}

${alert.message}

Expected: ${alert.expectedValue}
Actual: ${alert.actualValue}
Deviation: ${Number(alert.deviationPercent).toFixed(1)}%

Recommendation: ${alert.metadata?.recommendation || 'Review strategy performance'}

Days Live: ${deployment.daysLive}
Current Status: ${deployment.status}
`.trim();
  }

  /**
   * Format alert summary
   */
  private formatAlertSummary(alerts: DriftAlert[]): string {
    const bySeverity = alerts.reduce(
      (acc, alert) => {
        acc[alert.severity] = (acc[alert.severity] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const byType = alerts.reduce(
      (acc, alert) => {
        acc[alert.driftType] = (acc[alert.driftType] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    return `
DRIFT ALERT SUMMARY
===================

Total Alerts: ${alerts.length}

By Severity:
${Object.entries(bySeverity)
  .map(([severity, count]) => `  ${severity}: ${count}`)
  .join('\n')}

By Type:
${Object.entries(byType)
  .map(([type, count]) => `  ${type}: ${count}`)
  .join('\n')}

Critical Alerts Require Immediate Attention!
`.trim();
  }

  /**
   * Get alert recipients based on severity
   */
  private getAlertRecipients(severity: string): string[] {
    // TODO: Load from configuration
    const recipients: Record<string, string[]> = {
      critical: ['admin@example.com', 'trading-team@example.com'],
      high: ['admin@example.com'],
      medium: ['admin@example.com'],
      low: ['admin@example.com']
    };

    return recipients[severity] || recipients['low'];
  }

  /**
   * Escalate unresolved alerts
   */
  async escalateUnresolvedAlerts(): Promise<void> {
    const threshold = new Date();
    threshold.setHours(threshold.getHours() - 24); // 24 hours

    const unresolvedAlerts = await this.driftAlertRepo
      .createQueryBuilder('alert')
      .where('alert.resolved = :resolved', { resolved: false })
      .andWhere('alert.createdAt < :threshold', { threshold })
      .andWhere('alert.severity IN (:...severities)', { severities: ['high', 'critical'] })
      .getMany();

    if (unresolvedAlerts.length > 0) {
      this.logger.error(
        `⚠️  ESCALATION: ${unresolvedAlerts.length} unresolved high/critical alerts older than 24 hours`
      );

      // Emit risk breach notifications per affected deployment owner
      for (const alert of unresolvedAlerts) {
        const deployment = await this.deploymentRepo.findOne({
          where: { id: alert.deploymentId },
          relations: ['strategyConfig', 'strategyConfig.creator']
        });
        const userId = deployment?.strategyConfig?.creator?.id;
        if (userId) {
          this.eventEmitter.emit(NOTIFICATION_EVENTS.RISK_BREACH, {
            userId,
            metric: `Unresolved ${alert.driftType} alert`,
            threshold: 24,
            actual: Math.round((Date.now() - alert.createdAt.getTime()) / 3600000),
            strategyName: deployment.strategyConfig?.name,
            deploymentId: deployment.id
          });
        }
      }
    }
  }
}
