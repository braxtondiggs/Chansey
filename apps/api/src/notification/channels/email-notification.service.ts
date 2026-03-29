import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { APP_NAME, NotificationEventType } from '@chansey/api-interfaces';

import { COLORS, FONT_STACK } from '../../email/email-constants';
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
      subject: `${this.getSubjectPrefix(job.severity)} ${escapeHtml(job.title)}`.trim(),
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

    return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${escapeHtml(job.title)}</title>
  <!--[if mso]><style>table,td{font-family:Arial,Helvetica,sans-serif!important}</style><![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: ${COLORS.bg}; font-family: ${FONT_STACK}; -webkit-font-smoothing: antialiased;">
  <!-- Preheader -->
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
    ${escapeHtml(job.body)}${'&#847; &zwnj; &nbsp; '.repeat(20)}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: ${COLORS.bg};">
    <tr>
      <td align="center" style="padding: 40px 16px;">

        <!-- Card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; background-color: ${COLORS.cardBg}; border-radius: 12px; overflow: hidden; border: 1px solid ${COLORS.border};">

          <!-- Header -->
          <tr>
            <td style="background-color: ${severityColor}; padding: 28px 40px; text-align: center;">
              <h1 style="margin: 0; font-family: ${FONT_STACK}; font-size: 22px; font-weight: 700; color: #FFFFFF; letter-spacing: -0.2px;">${APP_NAME}</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 36px 40px 12px 40px;">
              <!-- Alert banner -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 20px 0;">
                <tr>
                  <td style="background-color: ${severityColor}10; border-left: 4px solid ${severityColor}; border-radius: 0 8px 8px 0; padding: 14px 18px;">
                    <p style="margin: 0; font-family: ${FONT_STACK}; font-size: 15px; line-height: 22px; font-weight: 600; color: ${COLORS.text};">${escapeHtml(job.title)}</p>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 16px 0; font-family: ${FONT_STACK}; font-size: 15px; line-height: 24px; color: ${COLORS.body};">Hi ${escapeHtml(job.userName)},</p>
              <p style="margin: 0 0 16px 0; font-family: ${FONT_STACK}; font-size: 15px; line-height: 24px; color: ${COLORS.body};">${escapeHtml(job.body)}</p>
              ${this.getDetailSection(job)}
              ${actionSection}
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 40px;">
              <div style="border-top: 1px solid ${COLORS.border};"></div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 40px 32px 40px;">
              <p style="margin: 0; font-family: ${FONT_STACK}; font-size: 13px; line-height: 20px; color: ${COLORS.subtle};">
                You received this because you have ${escapeHtml(job.eventType.replace(/_/g, ' '))} notifications enabled.
                <a href="${this.frontendUrl}/app/settings" style="color: ${COLORS.primary}; text-decoration: underline;">Manage preferences</a>
              </p>
            </td>
          </tr>
        </table>

        <!-- Brand -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px;">
          <tr>
            <td style="padding: 24px 40px; text-align: center;">
              <p style="margin: 0; font-family: ${FONT_STACK}; font-size: 12px; color: ${COLORS.subtle};">
                &copy; ${new Date().getFullYear()} ${APP_NAME} &middot; <a href="https://cymbit.com" style="color: ${COLORS.subtle}; text-decoration: underline;">cymbit.com</a>
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
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

    const row = (label: string, value: string, valueColor?: string) =>
      `<tr>
        <td style="padding: 8px 12px; font-family: ${FONT_STACK}; font-size: 13px; color: ${COLORS.muted}; border-bottom: 1px solid ${COLORS.border};">${label}</td>
        <td style="padding: 8px 12px; font-family: ${FONT_STACK}; font-size: 14px; font-weight: 500; color: ${valueColor ?? COLORS.text}; border-bottom: 1px solid ${COLORS.border}; text-align: right;">${value}</td>
      </tr>`;

    const tableWrap = (rows: string) =>
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 16px 0 24px 0; border: 1px solid ${COLORS.border}; border-radius: 8px; overflow: hidden; border-collapse: separate;">
        ${rows}
      </table>`;

    switch (job.eventType) {
      case NotificationEventType.TRADE_EXECUTED:
        return tableWrap(
          row('Action', escapeHtml(p['action'])) +
            row('Symbol', escapeHtml(p['symbol'])) +
            row('Quantity', escapeHtml(p['quantity'])) +
            row('Price', `$${escapeHtml(Number(p['price']).toFixed(2))}`) +
            row('Exchange', escapeHtml(p['exchangeName']))
        );

      case NotificationEventType.RISK_BREACH:
        return tableWrap(
          row('Metric', escapeHtml(p['metric'])) +
            row('Threshold', escapeHtml(p['threshold'])) +
            row('Actual', escapeHtml(p['actual']), '#DC2626')
        );

      case NotificationEventType.DRIFT_ALERT:
        return tableWrap(
          row('Strategy', escapeHtml(p['strategyName'])) +
            row('Drift Type', escapeHtml(p['driftType'])) +
            row('Deviation', `${escapeHtml(p['deviationPercent'])}%`)
        );

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

    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 28px 0;">
  <tr>
    <td align="center">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
        href="${url}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="17%" fillcolor="${COLORS.primary}" stroke="f">
        <w:anchorlock/>
        <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${label}</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-->
      <a href="${url}" style="display: inline-block; background-color: ${COLORS.primary}; color: #FFFFFF; font-family: ${FONT_STACK}; font-size: 15px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px; line-height: 1; border: 2px solid ${COLORS.primaryDark};">
        ${label}
      </a>
      <!--<![endif]-->
    </td>
  </tr>
</table>`;
  }
}
