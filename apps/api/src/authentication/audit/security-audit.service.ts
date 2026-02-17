import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { MoreThanOrEqual, Repository } from 'typeorm';

import { SecurityAuditLog, SecurityEventType } from './security-audit.entity';

export interface AuditLogParams {
  userId?: string;
  email?: string;
  eventType: SecurityEventType;
  ipAddress?: string;
  userAgent?: string;
  success?: boolean;
  failureReason?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class SecurityAuditService {
  private readonly logger = new Logger(SecurityAuditService.name);

  constructor(
    @InjectRepository(SecurityAuditLog)
    private readonly auditRepository: Repository<SecurityAuditLog>
  ) {}

  /**
   * Log a security event
   */
  async log(params: AuditLogParams): Promise<void> {
    try {
      const auditLog = this.auditRepository.create({
        userId: params.userId,
        email: params.email,
        eventType: params.eventType,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        success: params.success ?? true,
        failureReason: params.failureReason,
        metadata: params.metadata
      });

      await this.auditRepository.save(auditLog);

      // Also log to console for monitoring/alerting integration
      const logLevel = params.success === false ? 'warn' : 'debug';
      this.logger[logLevel](
        `Security event: ${params.eventType} | User: ${params.userId || params.email || 'unknown'} | Success: ${params.success ?? true}${params.failureReason ? ` | Reason: ${params.failureReason}` : ''}`
      );
    } catch (error: unknown) {
      // Don't let audit logging failures break the main flow
      this.logger.error(`Failed to log security event: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Log a successful login
   */
  async logLoginSuccess(userId: string, email: string, ipAddress?: string, userAgent?: string): Promise<void> {
    await this.log({
      userId,
      email,
      eventType: SecurityEventType.LOGIN_SUCCESS,
      ipAddress,
      userAgent,
      success: true
    });
  }

  /**
   * Log a failed login attempt
   */
  async logLoginFailed(
    email: string,
    reason: string,
    ipAddress?: string,
    userAgent?: string,
    userId?: string
  ): Promise<void> {
    await this.log({
      userId,
      email,
      eventType: SecurityEventType.LOGIN_FAILED,
      ipAddress,
      userAgent,
      success: false,
      failureReason: reason
    });
  }

  /**
   * Log account lockout
   */
  async logAccountLocked(userId: string, email: string, ipAddress?: string, userAgent?: string): Promise<void> {
    await this.log({
      userId,
      email,
      eventType: SecurityEventType.ACCOUNT_LOCKED,
      ipAddress,
      userAgent,
      success: false,
      failureReason: 'Too many failed login attempts'
    });
  }

  /**
   * Log password change
   */
  async logPasswordChanged(userId: string, email: string, ipAddress?: string, userAgent?: string): Promise<void> {
    await this.log({
      userId,
      email,
      eventType: SecurityEventType.PASSWORD_CHANGED,
      ipAddress,
      userAgent,
      success: true
    });
  }

  /**
   * Log password reset request
   */
  async logPasswordResetRequested(email: string, ipAddress?: string, userAgent?: string): Promise<void> {
    await this.log({
      email,
      eventType: SecurityEventType.PASSWORD_RESET_REQUESTED,
      ipAddress,
      userAgent,
      success: true
    });
  }

  /**
   * Log password reset completion
   */
  async logPasswordResetCompleted(
    userId: string,
    email: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await this.log({
      userId,
      email,
      eventType: SecurityEventType.PASSWORD_RESET_COMPLETED,
      ipAddress,
      userAgent,
      success: true
    });
  }

  /**
   * Log OTP enabled
   */
  async logOtpEnabled(userId: string, email: string, ipAddress?: string, userAgent?: string): Promise<void> {
    await this.log({
      userId,
      email,
      eventType: SecurityEventType.OTP_ENABLED,
      ipAddress,
      userAgent,
      success: true
    });
  }

  /**
   * Log OTP disabled
   */
  async logOtpDisabled(userId: string, email: string, ipAddress?: string, userAgent?: string): Promise<void> {
    await this.log({
      userId,
      email,
      eventType: SecurityEventType.OTP_DISABLED,
      ipAddress,
      userAgent,
      success: true
    });
  }

  /**
   * Log OTP verification failure
   */
  async logOtpFailed(
    email: string,
    reason: string,
    ipAddress?: string,
    userAgent?: string,
    userId?: string
  ): Promise<void> {
    await this.log({
      userId,
      email,
      eventType: SecurityEventType.OTP_FAILED,
      ipAddress,
      userAgent,
      success: false,
      failureReason: reason
    });
  }

  /**
   * Log new user registration
   */
  async logRegistration(userId: string, email: string, ipAddress?: string, userAgent?: string): Promise<void> {
    await this.log({
      userId,
      email,
      eventType: SecurityEventType.REGISTRATION,
      ipAddress,
      userAgent,
      success: true
    });
  }

  /**
   * Get recent security events for a user
   */
  async getRecentEventsForUser(userId: string, limit = 50): Promise<SecurityAuditLog[]> {
    return this.auditRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit
    });
  }

  /**
   * Get failed login attempts for a user in the last N minutes
   */
  async getRecentFailedAttempts(email: string, minutes = 15): Promise<number> {
    const since = new Date(Date.now() - minutes * 60 * 1000);

    const count = await this.auditRepository.count({
      where: {
        email,
        eventType: SecurityEventType.LOGIN_FAILED,
        createdAt: MoreThanOrEqual(since)
      }
    });

    return count;
  }
}
