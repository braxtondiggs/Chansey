import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { NotificationEventType } from '@chansey/api-interfaces';

import { EmailService } from '../../email/email.service';
import { escapeHtml } from '../../utils/sanitize.util';
import { NotificationJobData } from '../interfaces/notification-events.interface';

@Injectable()
export class EmailNotificationService {
  private readonly logger = new Logger(EmailNotificationService.name);
  private readonly frontendUrl: string;

  constructor(
    private readonly emailService: EmailService,
    private readonly config: ConfigService
  ) {
    this.frontendUrl = this.config.get<string>('FRONTEND_URL', 'https://cymbit.com');
  }

  async send(job: NotificationJobData): Promise<boolean> {
    const html = this.buildTemplate(job);

    return this.emailService.sendEmail({
      to: job.userEmail,
      subject: `${this.getSubjectPrefix(job.severity)} ${escapeHtml(job.title)}`,
      html
    });
  }

  private getSubjectPrefix(severity: string): string {
    switch (severity) {
      case 'critical':
        return '[URGENT]';
      case 'high':
        return '[Alert]';
      default:
        return '';
    }
  }

  private buildTemplate(job: NotificationJobData): string {
    const severityColor = this.getSeverityColor(job.severity);
    const actionSection = this.getActionSection(job);

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #4F46E5; margin: 0;">Cymbit Trading</h1>
        </div>
        <div style="background-color: ${severityColor}15; border-left: 4px solid ${severityColor}; padding: 12px 16px; margin-bottom: 20px; border-radius: 0 4px 4px 0;">
          <strong style="color: ${severityColor};">${escapeHtml(job.title)}</strong>
        </div>
        <p>Hi ${escapeHtml(job.userName)},</p>
        <p>${escapeHtml(job.body)}</p>
        ${this.getDetailSection(job)}
        ${actionSection}
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: #999; font-size: 12px;">
          You received this because you have ${escapeHtml(job.eventType.replace(/_/g, ' '))} notifications enabled.
          <a href="${this.frontendUrl}/app/settings" style="color: #4F46E5;">Manage preferences</a>
        </p>
      </body>
      </html>
    `;
  }

  private getSeverityColor(severity: string): string {
    switch (severity) {
      case 'critical':
        return '#DC2626';
      case 'high':
        return '#EA580C';
      case 'medium':
        return '#CA8A04';
      case 'low':
        return '#2563EB';
      default:
        return '#6B7280';
    }
  }

  private getDetailSection(job: NotificationJobData): string {
    const p = job.payload;

    switch (job.eventType) {
      case NotificationEventType.TRADE_EXECUTED:
        return `
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding: 6px 0; color: #666;">Action</td><td style="padding: 6px 0; font-weight: 500;">${escapeHtml(p['action'])}</td></tr>
            <tr><td style="padding: 6px 0; color: #666;">Symbol</td><td style="padding: 6px 0; font-weight: 500;">${escapeHtml(p['symbol'])}</td></tr>
            <tr><td style="padding: 6px 0; color: #666;">Quantity</td><td style="padding: 6px 0; font-weight: 500;">${escapeHtml(p['quantity'])}</td></tr>
            <tr><td style="padding: 6px 0; color: #666;">Price</td><td style="padding: 6px 0; font-weight: 500;">$${escapeHtml(Number(p['price']).toFixed(2))}</td></tr>
            <tr><td style="padding: 6px 0; color: #666;">Exchange</td><td style="padding: 6px 0; font-weight: 500;">${escapeHtml(p['exchangeName'])}</td></tr>
          </table>`;

      case NotificationEventType.RISK_BREACH:
        return `
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding: 6px 0; color: #666;">Metric</td><td style="padding: 6px 0; font-weight: 500;">${escapeHtml(p['metric'])}</td></tr>
            <tr><td style="padding: 6px 0; color: #666;">Threshold</td><td style="padding: 6px 0; font-weight: 500;">${escapeHtml(p['threshold'])}</td></tr>
            <tr><td style="padding: 6px 0; color: #666;">Actual</td><td style="padding: 6px 0; font-weight: 500; color: #DC2626;">${escapeHtml(p['actual'])}</td></tr>
          </table>`;

      case NotificationEventType.DRIFT_ALERT:
        return `
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding: 6px 0; color: #666;">Strategy</td><td style="padding: 6px 0; font-weight: 500;">${escapeHtml(p['strategyName'])}</td></tr>
            <tr><td style="padding: 6px 0; color: #666;">Drift Type</td><td style="padding: 6px 0; font-weight: 500;">${escapeHtml(p['driftType'])}</td></tr>
            <tr><td style="padding: 6px 0; color: #666;">Deviation</td><td style="padding: 6px 0; font-weight: 500;">${escapeHtml(p['deviationPercent'])}%</td></tr>
          </table>`;

      default:
        return '';
    }
  }

  private getActionSection(job: NotificationJobData): string {
    let url = `${this.frontendUrl}/app`;
    let label = 'View Dashboard';

    switch (job.eventType) {
      case NotificationEventType.TRADE_EXECUTED:
      case NotificationEventType.TRADE_ERROR:
        url = `${this.frontendUrl}/app/transactions`;
        label = 'View Transactions';
        break;
      case NotificationEventType.RISK_BREACH:
      case NotificationEventType.DRIFT_ALERT:
      case NotificationEventType.STRATEGY_DEMOTED:
        url = `${this.frontendUrl}/app/algorithms`;
        label = 'View Strategies';
        break;
    }

    return `
      <div style="text-align: center; margin: 30px 0;">
        <a href="${url}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 500;">
          ${label}
        </a>
      </div>
    `;
  }
}
