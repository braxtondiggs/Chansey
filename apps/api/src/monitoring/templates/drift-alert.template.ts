import { Deployment } from '../../strategy/entities/deployment.entity';
import { DriftAlert } from '../entities/drift-alert.entity';

/**
 * Drift Alert Templates
 *
 * Formatted message templates for different drift types.
 * Used for email notifications, Slack messages, etc.
 */

export class DriftAlertTemplate {
  /**
   * Generate email subject line
   */
  static getEmailSubject(alert: DriftAlert, deployment: Deployment): string {
    const severityPrefix = {
      critical: '🚨 CRITICAL',
      high: '⚠️  HIGH',
      medium: '⚡ MEDIUM',
      low: 'ℹ️  LOW'
    }[alert.severity];

    return `${severityPrefix}: ${alert.driftType.replace('_', ' ').toUpperCase()} Drift - ${deployment.strategyConfig?.name}`;
  }

  /**
   * Generate email body (HTML)
   */
  static getEmailBody(alert: DriftAlert, deployment: Deployment): string {
    const strategyName = deployment.strategyConfig?.name || 'Unknown Strategy';
    const severityColor = {
      critical: '#DC2626',
      high: '#F59E0B',
      medium: '#3B82F6',
      low: '#6B7280'
    }[alert.severity];

    return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .alert-box { border-left: 4px solid ${severityColor}; padding: 20px; margin: 20px 0; background: #f9fafb; }
    .metric { background: #fff; padding: 10px; margin: 10px 0; border-radius: 4px; }
    .metric-label { font-weight: bold; color: #6B7280; }
    .metric-value { font-size: 1.2em; color: #111827; }
    .recommendation { background: #FEF3C7; border-left: 3px solid #F59E0B; padding: 15px; margin: 20px 0; }
    .footer { color: #6B7280; font-size: 0.9em; margin-top: 30px; padding-top: 20px; border-top: 1px solid #E5E7EB; }
  </style>
</head>
<body>
  <div class="alert-box">
    <h2 style="color: ${severityColor}; margin-top: 0;">${alert.severity.toUpperCase()} Drift Alert</h2>

    <h3>Strategy: ${strategyName}</h3>
    <p><strong>Deployment ID:</strong> ${deployment.id}</p>
    <p><strong>Drift Type:</strong> ${alert.driftType.replace('_', ' ').toUpperCase()}</p>
    <p><strong>Alert Time:</strong> ${alert.createdAt.toISOString()}</p>
  </div>

  <div style="margin: 20px 0;">
    <h3>Performance Details</h3>

    <div class="metric">
      <div class="metric-label">Expected Value</div>
      <div class="metric-value">${alert.expectedValue}</div>
    </div>

    <div class="metric">
      <div class="metric-label">Actual Value</div>
      <div class="metric-value" style="color: ${severityColor};">${alert.actualValue}</div>
    </div>

    <div class="metric">
      <div class="metric-label">Deviation</div>
      <div class="metric-value">${Number(alert.deviationPercent).toFixed(1)}%</div>
    </div>
  </div>

  <div class="recommendation">
    <h4 style="margin-top: 0;">📋 Recommendation</h4>
    <p>${alert.metadata?.recommendation || 'Review strategy performance and consider appropriate action.'}</p>
  </div>

  <div style="margin: 20px 0;">
    <h3>Deployment Status</h3>
    <p><strong>Days Live:</strong> ${deployment.daysLive}</p>
    <p><strong>Status:</strong> ${deployment.status}</p>
    <p><strong>Total Drift Alerts:</strong> ${deployment.driftAlertCount}</p>
  </div>

  <div class="footer">
    <p>This is an automated alert from the Chansey Automated Backtesting Orchestration system.</p>
    <p>View deployment details in the dashboard or contact the trading team for assistance.</p>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Generate Slack message payload
   */
  static getSlackMessage(alert: DriftAlert, deployment: Deployment): any {
    const strategyName = deployment.strategyConfig?.name || 'Unknown Strategy';
    const severityColor = {
      critical: 'danger',
      high: 'warning',
      medium: '#3B82F6',
      low: 'good'
    }[alert.severity];

    const severityEmoji = {
      critical: '🚨',
      high: '⚠️',
      medium: '⚡',
      low: 'ℹ️'
    }[alert.severity];

    return {
      text: `${severityEmoji} ${alert.severity.toUpperCase()} Drift Alert: ${strategyName}`,
      attachments: [
        {
          color: severityColor,
          title: `${alert.driftType.replace('_', ' ').toUpperCase()} Drift Detected`,
          fields: [
            {
              title: 'Strategy',
              value: strategyName,
              short: true
            },
            {
              title: 'Deployment ID',
              value: deployment.id,
              short: true
            },
            {
              title: 'Expected Value',
              value: String(alert.expectedValue),
              short: true
            },
            {
              title: 'Actual Value',
              value: String(alert.actualValue),
              short: true
            },
            {
              title: 'Deviation',
              value: `${Number(alert.deviationPercent).toFixed(1)}%`,
              short: true
            },
            {
              title: 'Days Live',
              value: String(deployment.daysLive),
              short: true
            }
          ],
          text: alert.metadata?.recommendation || 'Review strategy performance',
          footer: 'Chansey Trading System',
          ts: Math.floor(alert.createdAt.getTime() / 1000)
        }
      ]
    };
  }

  /**
   * Generate SMS message (short format)
   */
  static getSMSMessage(alert: DriftAlert, deployment: Deployment): string {
    const strategyName = deployment.strategyConfig?.name || 'Unknown';
    return `${alert.severity.toUpperCase()} ALERT: ${strategyName} - ${alert.driftType} drift ${Number(alert.deviationPercent).toFixed(0)}%. Check dashboard immediately.`;
  }
}
