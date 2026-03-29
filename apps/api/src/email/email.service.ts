import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Resend } from 'resend';

import { APP_NAME } from '@chansey/api-interfaces';

import { COLORS, FONT_STACK } from './email-constants';

import { toErrorInfo } from '../shared/error.util';
import { escapeHtml } from '../utils/sanitize.util';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend;
  private readonly fromEmail: string;
  private readonly frontendUrl: string;

  constructor(private readonly config: ConfigService) {
    this.resend = new Resend(this.config.get<string>('RESEND_API_KEY'));
    this.fromEmail = this.config.get<string>('RESEND_FROM_EMAIL', 'noreply@cymbit.com');
    this.frontendUrl = this.config.get<string>('FRONTEND_URL', 'https://cymbit.com');
  }

  async sendEmail(options: EmailOptions): Promise<boolean> {
    try {
      const { data, error } = await this.resend.emails.send({
        from: `${APP_NAME} <${this.fromEmail}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text
      });

      if (error) {
        this.logger.error(`Failed to send email to ${options.to}: ${error.message}`);
        return false;
      }

      this.logger.debug(`Email sent successfully to ${options.to}, ID: ${data?.id}`);
      return true;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Email send error: ${err.message}`, err.stack);
      return false;
    }
  }

  async sendVerificationEmail(email: string, token: string, name: string): Promise<boolean> {
    const verificationUrl = `${this.frontendUrl}/auth/verify-email?token=${token}`;

    return this.sendEmail({
      to: email,
      subject: `Verify your ${APP_NAME} account`,
      html: wrapTemplate({
        preheader: `Welcome! Verify your email to get started with ${APP_NAME}.`,
        heading: `Welcome to ${APP_NAME}!`,
        headingColor: COLORS.primary,
        body: `
          <p style="${bodyText()}">Hi ${escapeHtml(name)},</p>
          <p style="${bodyText()}">Thanks for signing up! Please verify your email address to activate your account.</p>
          ${button('Verify Email Address', verificationUrl, COLORS.primary, COLORS.primaryDark)}
          ${linkFallback(verificationUrl)}
          <p style="${mutedText()}">This link expires in 24 hours.</p>
        `,
        footer: `If you didn't create an account with ${APP_NAME}, you can safely ignore this email.`
      })
    });
  }

  async sendOtpEmail(email: string, otp: string, name: string): Promise<boolean> {
    const digits = otp.split('');

    return this.sendEmail({
      to: email,
      subject: `Your ${APP_NAME} verification code`,
      html: wrapTemplate({
        preheader: `Your verification code is ${otp}`,
        heading: 'Verification Code',
        headingColor: COLORS.primary,
        body: `
          <p style="${bodyText()}">Hi ${escapeHtml(name)},</p>
          <p style="${bodyText()}">Enter this code to verify your identity:</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 32px 0;">
            <tr>
              <td align="center">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    ${digits.map((d) => `<td style="padding: 0 4px;"><div style="width: 44px; height: 56px; line-height: 56px; text-align: center; font-size: 28px; font-weight: 700; font-family: ${FONT_STACK}; color: ${COLORS.text}; background-color: ${COLORS.codeBg}; border: 1px solid ${COLORS.border}; border-radius: 8px;">${d}</div></td>`).join('')}
                  </tr>
                </table>
              </td>
            </tr>
          </table>
          <p style="${mutedText()} text-align: center;">This code expires in 10 minutes.</p>
        `,
        footer: `If you didn't request this code, please secure your account immediately by changing your password.`
      })
    });
  }

  async sendPasswordResetEmail(email: string, token: string, name: string): Promise<boolean> {
    const resetUrl = `${this.frontendUrl}/auth/reset-password?token=${token}`;

    return this.sendEmail({
      to: email,
      subject: `Reset your ${APP_NAME} password`,
      html: wrapTemplate({
        preheader: 'You requested a password reset. Click the link inside to choose a new password.',
        heading: 'Password Reset',
        headingColor: COLORS.primary,
        body: `
          <p style="${bodyText()}">Hi ${escapeHtml(name)},</p>
          <p style="${bodyText()}">We received a request to reset your password. Click the button below to choose a new one:</p>
          ${button('Reset Password', resetUrl, COLORS.primary, COLORS.primaryDark)}
          ${linkFallback(resetUrl)}
          <p style="${mutedText()}">This link expires in 1 hour.</p>
        `,
        footer: `If you didn't request a password reset, you can safely ignore this email. Your password will not be changed.`
      })
    });
  }

  async sendExchangeKeyWarningEmail(
    email: string,
    name: string,
    exchangeName: string,
    failures: number
  ): Promise<boolean> {
    const settingsUrl = `${this.frontendUrl}/app/settings/exchanges`;

    return this.sendEmail({
      to: email,
      subject: `${APP_NAME}: Your ${exchangeName} API key needs attention`,
      html: wrapTemplate({
        preheader: `Your ${exchangeName} API key has failed ${failures} health checks and may need updating.`,
        heading: 'API Key Warning',
        headingColor: COLORS.warning,
        body: `
          <p style="${bodyText()}">Hi ${escapeHtml(name)},</p>
          ${alertBox(COLORS.warning, COLORS.warningBg, `Your <strong>${escapeHtml(exchangeName)}</strong> API key has failed ${failures} consecutive health checks.`)}
          <p style="${bodyText()}">This may indicate that your API key has expired, been revoked, or had its permissions changed.</p>
          <p style="${bodyText()}">If this continues, we will automatically deactivate the key to prevent further errors.</p>
          ${button('Review API Keys', settingsUrl, COLORS.warning, COLORS.warningDark)}
        `,
        footer: `You received this email because your exchange API key is experiencing issues. If you have already resolved this, you can ignore this email.`
      })
    });
  }

  async sendExchangeKeyDeactivatedEmail(email: string, name: string, exchangeName: string): Promise<boolean> {
    const settingsUrl = `${this.frontendUrl}/app/settings/exchanges`;

    return this.sendEmail({
      to: email,
      subject: `${APP_NAME}: Your ${exchangeName} API key has been deactivated`,
      html: wrapTemplate({
        preheader: `Your ${exchangeName} API key was deactivated after repeated failures. Update it to resume trading.`,
        heading: 'API Key Deactivated',
        headingColor: COLORS.danger,
        body: `
          <p style="${bodyText()}">Hi ${escapeHtml(name)},</p>
          ${alertBox(COLORS.danger, COLORS.dangerBg, `Your <strong>${escapeHtml(exchangeName)}</strong> API key has been automatically deactivated after repeated authentication failures.`)}
          <p style="${bodyText()}">This usually means your API key has expired or been revoked on the exchange side. To resume trading:</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 16px 0 24px 0;">
            ${numberedStep(1, `Generate a new API key on ${escapeHtml(exchangeName)}`)}
            ${numberedStep(2, 'Remove the old key in your settings')}
            ${numberedStep(3, 'Add the new key to reconnect')}
          </table>
          ${button('Manage API Keys', settingsUrl, COLORS.primary, COLORS.primaryDark)}
        `,
        footer: `You received this email because your exchange API key was deactivated for security. No further actions will be taken with this key until you update it.`
      })
    });
  }

  async sendWelcomeEmail(email: string, name: string): Promise<boolean> {
    const dashboardUrl = `${this.frontendUrl}/app`;

    return this.sendEmail({
      to: email,
      subject: `Welcome to ${APP_NAME}!`,
      html: wrapTemplate({
        preheader: `Your account is active! Start trading with ${APP_NAME}.`,
        heading: `You're all set!`,
        headingColor: COLORS.primary,
        body: `
          <p style="${bodyText()}">Hi ${escapeHtml(name)},</p>
          <p style="${bodyText()}">Your email has been verified and your account is now active. Here's what you can do next:</p>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 24px 0;">
            ${featureRow('Connect Exchanges', 'Link your Binance or Coinbase account')}
            ${featureRow('Track Portfolio', 'Monitor your holdings and performance')}
            ${featureRow('Algo Trading', 'Set up automated trading strategies')}
            ${featureRow('Live Data', 'Watch real-time market prices and trends')}
          </table>
          ${button('Go to Dashboard', dashboardUrl, COLORS.primary, COLORS.primaryDark)}
        `,
        footer: `Need help getting started? Reply to this email or visit our documentation.`
      })
    });
  }
}

// ---------------------------------------------------------------------------
// Template helpers
// ---------------------------------------------------------------------------

interface TemplateOptions {
  preheader: string;
  heading: string;
  headingColor: string;
  body: string;
  footer: string;
}

function wrapTemplate({ preheader, heading, headingColor, body, footer }: TemplateOptions): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${heading}</title>
  <!--[if mso]><style>table,td{font-family:Arial,Helvetica,sans-serif!important}</style><![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: ${COLORS.bg}; font-family: ${FONT_STACK}; -webkit-font-smoothing: antialiased;">
  <!-- Preheader -->
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
    ${preheader}${'&#847; &zwnj; &nbsp; '.repeat(20)}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: ${COLORS.bg};">
    <tr>
      <td align="center" style="padding: 40px 16px;">

        <!-- Card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; background-color: ${COLORS.cardBg}; border-radius: 12px; overflow: hidden; border: 1px solid ${COLORS.border};">

          <!-- Header -->
          <tr>
            <td style="background-color: ${headingColor}; padding: 28px 40px; text-align: center;">
              <h1 style="margin: 0; font-family: ${FONT_STACK}; font-size: 22px; font-weight: 700; color: #FFFFFF; letter-spacing: -0.2px;">${heading}</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 36px 40px 12px 40px;">
              ${body}
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
              <p style="margin: 0; font-family: ${FONT_STACK}; font-size: 13px; line-height: 20px; color: ${COLORS.subtle};">${footer}</p>
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

function button(label: string, href: string, color: string, borderColor: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 28px 0;">
  <tr>
    <td align="center">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
        href="${href}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="17%" fillcolor="${color}" stroke="f">
        <w:anchorlock/>
        <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${label}</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-->
      <a href="${href}" style="display: inline-block; background-color: ${color}; color: #FFFFFF; font-family: ${FONT_STACK}; font-size: 15px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px; line-height: 1; border: 2px solid ${borderColor};">
        ${label}
      </a>
      <!--<![endif]-->
    </td>
  </tr>
</table>`;
}

function linkFallback(url: string): string {
  return `<p style="font-family: ${FONT_STACK}; font-size: 13px; line-height: 20px; color: ${COLORS.muted}; margin: 0 0 8px 0;">
  Or copy this link: <a href="${url}" style="color: ${COLORS.primary}; word-break: break-all; text-decoration: underline;">${url}</a>
</p>`;
}

function alertBox(color: string, bgColor: string, message: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 16px 0 20px 0;">
  <tr>
    <td style="background-color: ${bgColor}; border-left: 4px solid ${color}; border-radius: 0 8px 8px 0; padding: 14px 18px;">
      <p style="margin: 0; font-family: ${FONT_STACK}; font-size: 15px; line-height: 22px; color: ${COLORS.text};">${message}</p>
    </td>
  </tr>
</table>`;
}

function numberedStep(num: number, text: string): string {
  return `<tr>
  <td style="padding: 6px 0; vertical-align: top; width: 32px;">
    <div style="width: 26px; height: 26px; line-height: 26px; text-align: center; border-radius: 50%; background-color: ${COLORS.primary}; color: #FFFFFF; font-family: ${FONT_STACK}; font-size: 13px; font-weight: 600;">${num}</div>
  </td>
  <td style="padding: 6px 0 6px 12px; vertical-align: top;">
    <p style="margin: 0; font-family: ${FONT_STACK}; font-size: 15px; line-height: 26px; color: ${COLORS.body};">${text}</p>
  </td>
</tr>`;
}

function featureRow(title: string, description: string): string {
  return `<tr>
  <td style="padding: 10px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="vertical-align: top; width: 8px;">
          <div style="width: 8px; height: 8px; border-radius: 50%; background-color: ${COLORS.primary}; margin-top: 7px;"></div>
        </td>
        <td style="padding-left: 14px;">
          <p style="margin: 0; font-family: ${FONT_STACK}; font-size: 15px; font-weight: 600; line-height: 22px; color: ${COLORS.text};">${title}</p>
          <p style="margin: 2px 0 0 0; font-family: ${FONT_STACK}; font-size: 14px; line-height: 20px; color: ${COLORS.muted};">${description}</p>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function bodyText(): string {
  return `margin: 0 0 16px 0; font-family: ${FONT_STACK}; font-size: 15px; line-height: 24px; color: ${COLORS.body};`;
}

function mutedText(): string {
  return `margin: 0 0 16px 0; font-family: ${FONT_STACK}; font-size: 13px; line-height: 20px; color: ${COLORS.muted};`;
}
