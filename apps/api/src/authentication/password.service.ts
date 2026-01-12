import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import * as bcrypt from 'bcrypt';

import * as crypto from 'crypto';

@Injectable()
export class PasswordService {
  private readonly SALT_ROUNDS: number;
  private readonly OTP_SALT_ROUNDS: number;
  private readonly OTP_EXPIRATION_MINUTES: number;
  private readonly EMAIL_VERIFICATION_EXPIRATION_HOURS: number;
  private readonly PASSWORD_RESET_EXPIRATION_HOURS: number;

  constructor(private readonly configService: ConfigService) {
    this.SALT_ROUNDS = this.configService.get<number>('PASSWORD_SALT_ROUNDS', 12);
    this.OTP_SALT_ROUNDS = this.configService.get<number>('OTP_SALT_ROUNDS', 6);
    this.OTP_EXPIRATION_MINUTES = this.configService.get<number>('OTP_EXPIRATION_MINUTES', 10);
    this.EMAIL_VERIFICATION_EXPIRATION_HOURS = this.configService.get<number>(
      'EMAIL_VERIFICATION_EXPIRATION_HOURS',
      24
    );
    this.PASSWORD_RESET_EXPIRATION_HOURS = this.configService.get<number>('PASSWORD_RESET_EXPIRATION_HOURS', 1);
  }

  /**
   * Hash a password using bcrypt with 12 salt rounds
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.SALT_ROUNDS);
  }

  /**
   * Verify a password against a bcrypt hash
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Generate a cryptographically secure random token (64 hex characters)
   * Used for email verification and password reset tokens
   */
  generateSecureToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Generate a cryptographically secure 6-digit numeric OTP code
   */
  generateOtp(): string {
    return crypto.randomInt(100000, 1000000).toString();
  }

  /**
   * Hash an OTP code for secure storage
   * Uses fewer rounds than password hashing since OTPs are short-lived
   */
  async hashOtp(otp: string): Promise<string> {
    return bcrypt.hash(otp, this.OTP_SALT_ROUNDS);
  }

  /**
   * Verify an OTP against its hash
   */
  async verifyOtp(otp: string, hash: string): Promise<boolean> {
    return bcrypt.compare(otp, hash);
  }

  /**
   * Get OTP expiration time (configurable, default 10 minutes from now)
   */
  getOtpExpiration(): Date {
    return new Date(Date.now() + this.OTP_EXPIRATION_MINUTES * 60 * 1000);
  }

  /**
   * Get email verification token expiration time (configurable, default 24 hours from now)
   */
  getVerificationTokenExpiration(): Date {
    return new Date(Date.now() + this.EMAIL_VERIFICATION_EXPIRATION_HOURS * 60 * 60 * 1000);
  }

  /**
   * Get password reset token expiration time (configurable, default 1 hour from now)
   */
  getPasswordResetExpiration(): Date {
    return new Date(Date.now() + this.PASSWORD_RESET_EXPIRATION_HOURS * 60 * 60 * 1000);
  }
}
