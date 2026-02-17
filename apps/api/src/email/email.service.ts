import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Resend } from 'resend';

import { toErrorInfo } from '../shared/error.util';

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
        from: `Cymbit Trading <${this.fromEmail}>`,
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
      subject: 'Verify your Cymbit Trading account',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #4F46E5; margin: 0;">Welcome to Cymbit Trading!</h1>
          </div>
          <p>Hi ${name},</p>
          <p>Thank you for signing up! Please verify your email address by clicking the button below:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationUrl}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 500;">
              Verify Email Address
            </a>
          </div>
          <p style="color: #666; font-size: 14px;">Or copy and paste this link into your browser:</p>
          <p style="color: #4F46E5; font-size: 14px; word-break: break-all;">${verificationUrl}</p>
          <p style="color: #666; font-size: 14px;">This link expires in 24 hours.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          <p style="color: #999; font-size: 12px;">If you didn't create an account with Cymbit Trading, you can safely ignore this email.</p>
        </body>
        </html>
      `
    });
  }

  async sendOtpEmail(email: string, otp: string, name: string): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: 'Your Cymbit Trading verification code',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #4F46E5; margin: 0;">Verification Code</h1>
          </div>
          <p>Hi ${name},</p>
          <p>Your one-time verification code is:</p>
          <div style="text-align: center; margin: 30px 0;">
            <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; padding: 20px 30px; background-color: #F3F4F6; border-radius: 8px; display: inline-block; color: #1F2937;">
              ${otp}
            </div>
          </div>
          <p style="color: #666; font-size: 14px; text-align: center;">This code expires in 10 minutes.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          <p style="color: #999; font-size: 12px;">If you didn't request this code, please secure your account immediately by changing your password.</p>
        </body>
        </html>
      `
    });
  }

  async sendPasswordResetEmail(email: string, token: string, name: string): Promise<boolean> {
    const resetUrl = `${this.frontendUrl}/auth/reset-password?token=${token}`;

    return this.sendEmail({
      to: email,
      subject: 'Reset your Cymbit Trading password',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #4F46E5; margin: 0;">Password Reset</h1>
          </div>
          <p>Hi ${name},</p>
          <p>We received a request to reset your password. Click the button below to choose a new password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 500;">
              Reset Password
            </a>
          </div>
          <p style="color: #666; font-size: 14px;">Or copy and paste this link into your browser:</p>
          <p style="color: #4F46E5; font-size: 14px; word-break: break-all;">${resetUrl}</p>
          <p style="color: #666; font-size: 14px;">This link expires in 1 hour.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          <p style="color: #999; font-size: 12px;">If you didn't request a password reset, you can safely ignore this email. Your password will not be changed.</p>
        </body>
        </html>
      `
    });
  }

  async sendWelcomeEmail(email: string, name: string): Promise<boolean> {
    const dashboardUrl = `${this.frontendUrl}/app`;

    return this.sendEmail({
      to: email,
      subject: 'Welcome to Cymbit Trading!',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #4F46E5; margin: 0;">Welcome to Cymbit Trading!</h1>
          </div>
          <p>Hi ${name},</p>
          <p>Your email has been verified and your account is now active. You're all set to start trading!</p>
          <h3 style="color: #1F2937;">Here's what you can do:</h3>
          <ul style="color: #4B5563;">
            <li>Connect your exchange accounts (Binance, Coinbase)</li>
            <li>Track your portfolio performance</li>
            <li>Set up algorithmic trading strategies</li>
            <li>Monitor real-time market data</li>
          </ul>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${dashboardUrl}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 500;">
              Go to Dashboard
            </a>
          </div>
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          <p style="color: #999; font-size: 12px;">Need help? Reply to this email or visit our documentation.</p>
        </body>
        </html>
      `
    });
  }
}
