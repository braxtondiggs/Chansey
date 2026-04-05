import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { SecurityAuditService } from './audit';
import { VerifyOtpDto } from './dto';
import { PasswordService } from './password.service';

import {
  InvalidCredentialsException,
  InvalidOtpException,
  OtpExpiredException,
  TooManyOtpAttemptsException,
  ValidationException
} from '../common/exceptions';
import { EmailService } from '../email/email.service';
import { User } from '../users/users.entity';
import { UsersService } from '../users/users.service';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly MAX_OTP_ATTEMPTS = 3;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly user: UsersService,
    private readonly password: PasswordService,
    private readonly email: EmailService,
    private readonly securityAudit: SecurityAuditService
  ) {}

  public async sendLoginOtp(user: Pick<User, 'id' | 'email' | 'given_name'>) {
    const otpCode = this.password.generateOtp();
    const otpHash = await this.password.hashOtp(otpCode);
    const otpExpiresAt = this.password.getOtpExpiration();

    await this.userRepository.update(user.id, {
      otpHash,
      otpExpiresAt,
      otpFailedAttempts: 0 // Reset failed attempts on new OTP
    });

    const emailSent = await this.email.sendOtpEmail(user.email, otpCode, user.given_name);
    if (!emailSent) {
      this.logger.warn(`Failed to send OTP email to ${user.email}`);
    }
  }

  public async verifyOtp(verifyOtpDto: VerifyOtpDto) {
    const user = await this.userRepository.findOne({
      where: { email: verifyOtpDto.email },
      select: ['id', 'email', 'given_name', 'family_name', 'otpHash', 'otpExpiresAt', 'otpFailedAttempts', 'roles']
    });

    if (!user || !user.otpHash) {
      throw new InvalidOtpException();
    }

    // Check if OTP attempts are locked out
    if (user.otpFailedAttempts >= this.MAX_OTP_ATTEMPTS) {
      throw new TooManyOtpAttemptsException();
    }

    if (user.otpExpiresAt && user.otpExpiresAt < new Date()) {
      throw new OtpExpiredException();
    }

    // Verify OTP using secure comparison
    const isValidOtp = await this.password.verifyOtp(verifyOtpDto.otp, user.otpHash);

    if (!isValidOtp) {
      // Increment failed OTP attempts
      await this.userRepository.update(user.id, {
        otpFailedAttempts: (user.otpFailedAttempts || 0) + 1
      });

      // Audit log: OTP failed
      await this.securityAudit.logOtpFailed(verifyOtpDto.email, 'Invalid OTP code', undefined, undefined, user.id);
      throw new InvalidOtpException();
    }

    // Clear OTP and update login time
    await this.userRepository.update(user.id, {
      otpHash: null,
      otpExpiresAt: null,
      otpFailedAttempts: 0,
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date()
    });

    // Audit log: OTP verified and login success
    await this.securityAudit.logLoginSuccess(user.id, user.email);

    // Get full user data
    const userData = await this.user.getById(user.id);
    userData.roles = user.roles;

    return {
      user: userData,
      message: 'OTP verified successfully'
    };
  }

  public async resendOtp(email: string) {
    const ANTI_ENUM_MSG = 'If an account exists, an OTP will be sent.';

    const user = await this.userRepository.findOne({
      where: { email },
      select: ['id', 'email', 'given_name', 'otpEnabled', 'otpExpiresAt']
    });

    if (!user) {
      return { message: ANTI_ENUM_MSG };
    }

    // Cooldown: if OTP was sent within the last 60 seconds, return early
    if (user.otpExpiresAt) {
      const otpSentAt = user.otpExpiresAt.getTime() - this.password.getOtpLifetimeMs();
      if (Date.now() - otpSentAt < 60_000) {
        return { message: ANTI_ENUM_MSG };
      }
    }

    await this.sendLoginOtp(user);
    return { message: 'OTP sent successfully' };
  }

  public async enableOtp(userId: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'email']
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.userRepository.update(userId, { otpEnabled: true });

    // Audit log: OTP enabled
    await this.securityAudit.logOtpEnabled(userId, user.email);

    return { message: 'OTP enabled successfully' };
  }

  public async disableOtp(userId: string, password: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'email', 'passwordHash']
    });

    if (!user?.passwordHash) {
      throw new ValidationException('Cannot verify password');
    }

    const isValid = await this.password.verifyPassword(password, user.passwordHash);
    if (!isValid) {
      throw new InvalidCredentialsException('Invalid password');
    }

    await this.userRepository.update(userId, { otpEnabled: false });

    // Audit log: OTP disabled
    await this.securityAudit.logOtpDisabled(userId, user.email);

    return { message: 'OTP disabled successfully' };
  }
}
