import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { SecurityAuditService } from './audit';
import { VerifyOtpDto } from './dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { PasswordService } from './password.service';

import {
  AccountLockedException,
  AppException,
  EmailAlreadyExistsException,
  EmailNotVerifiedException,
  InternalException,
  InvalidCredentialsException,
  InvalidOtpException,
  InvalidTokenException,
  OtpExpiredException,
  PasswordMismatchException,
  TokenExpiredException,
  TooManyOtpAttemptsException,
  ValidationException
} from '../common/exceptions';
import { EmailService } from '../email/email.service';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { User } from '../users/users.entity';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthenticationService {
  private readonly logger = new Logger(AuthenticationService.name);
  private readonly MAX_LOGIN_ATTEMPTS = 5;
  private readonly MAX_OTP_ATTEMPTS = 3;
  private readonly LOCKOUT_DURATION_MINUTES = 15;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    readonly config: ConfigService,
    private readonly user: UsersService,
    private readonly password: PasswordService,
    private readonly email: EmailService,
    private readonly securityAudit: SecurityAuditService
  ) {}

  public async register(registrationData: CreateUserDto) {
    try {
      // Check if user already exists
      const existingUser = await this.userRepository.findOne({
        where: { email: registrationData.email }
      });

      if (existingUser) {
        throw new EmailAlreadyExistsException();
      }

      // Hash password
      const passwordHash = await this.password.hashPassword(registrationData.password);

      // Generate email verification token
      const emailVerificationToken = this.password.generateSecureToken();
      const emailVerificationTokenExpiresAt = this.password.getVerificationTokenExpiration();

      // Generate unique user ID
      const userId = uuidv4();

      // Create user with native auth fields
      const newUser = await this.user.create({
        id: userId,
        email: registrationData.email,
        given_name: registrationData.given_name,
        family_name: registrationData.family_name,
        passwordHash,
        emailVerified: false,
        emailVerificationToken,
        emailVerificationTokenExpiresAt,
        roles: ['user']
      });

      // Send verification email
      const emailSent = await this.email.sendVerificationEmail(
        registrationData.email,
        emailVerificationToken,
        registrationData.given_name
      );

      if (!emailSent) {
        this.logger.warn(`Failed to send verification email to ${registrationData.email}`);
      }

      // Audit log: registration successful
      await this.securityAudit.logRegistration(newUser.id, newUser.email);

      return {
        message: 'Registration successful. Please check your email to verify your account.',
        user: {
          id: newUser.id,
          email: newUser.email,
          given_name: newUser.given_name,
          family_name: newUser.family_name
        }
      };
    } catch (error: unknown) {
      if (error instanceof AppException) {
        throw error;
      }

      this.logger.error(`Registration error: ${error instanceof Error ? error.message : 'Unknown error'}`);

      throw new InternalException('Registration failed. Please try again later.');
    }
  }

  public async verifyEmail(token: string) {
    const user = await this.userRepository.findOne({
      where: { emailVerificationToken: token },
      select: ['id', 'email', 'given_name', 'emailVerificationTokenExpiresAt']
    });

    if (!user) {
      throw new InvalidTokenException('verification');
    }

    if (user.emailVerificationTokenExpiresAt && user.emailVerificationTokenExpiresAt < new Date()) {
      throw new TokenExpiredException('verification');
    }

    await this.userRepository.update(user.id, {
      emailVerified: true,
      emailVerificationToken: undefined,
      emailVerificationTokenExpiresAt: undefined
    });

    // Send welcome email
    await this.email.sendWelcomeEmail(user.email, user.given_name);

    return { message: 'Email verified successfully' };
  }

  public async resendVerificationEmail(email: string) {
    const user = await this.userRepository.findOne({
      where: { email },
      select: ['id', 'email', 'given_name', 'emailVerified']
    });

    if (!user) {
      // Don't reveal if user exists
      return { message: 'If an account exists, a verification email will be sent.' };
    }

    if (user.emailVerified) {
      return { message: 'Email is already verified' };
    }

    const emailVerificationToken = this.password.generateSecureToken();
    const emailVerificationTokenExpiresAt = this.password.getVerificationTokenExpiration();

    await this.userRepository.update(user.id, {
      emailVerificationToken,
      emailVerificationTokenExpiresAt
    });

    const emailSent = await this.email.sendVerificationEmail(email, emailVerificationToken, user.given_name);
    if (!emailSent) {
      this.logger.warn(`Failed to resend verification email to ${email}`);
    }

    return { message: 'Verification email sent' };
  }

  public async getAuthenticatedUser(email: string, password: string, rememberMe = false) {
    try {
      // Find user with all fields needed for authentication and response
      const user = await this.userRepository.findOne({
        where: { email },
        select: [
          'id',
          'email',
          'given_name',
          'family_name',
          'middle_name',
          'nickname',
          'picture',
          'gender',
          'birthdate',
          'phone_number',
          'passwordHash',
          'emailVerified',
          'otpEnabled',
          'failedLoginAttempts',
          'lockedUntil',
          'lastLoginAt',
          'roles',
          'hide_balance',
          'algoTradingEnabled',
          'algoCapitalAllocationPercentage',
          'algoEnrolledAt'
        ],
        relations: ['risk']
      });

      if (!user) {
        throw new InvalidCredentialsException();
      }

      // Check if account is locked
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        const minutesRemaining = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
        throw new AccountLockedException(minutesRemaining);
      }

      // Check if password hash exists (for migrated users who might not have one yet)
      if (!user.passwordHash) {
        throw new ValidationException('Please reset your password to continue');
      }

      // Verify password
      const isPasswordValid = await this.password.verifyPassword(password, user.passwordHash);

      if (!isPasswordValid) {
        // Increment failed attempts
        const newFailedAttempts = (user.failedLoginAttempts || 0) + 1;
        const updateData: Partial<User> = { failedLoginAttempts: newFailedAttempts };

        // Audit log: failed login
        await this.securityAudit.logLoginFailed(email, 'Invalid password', undefined, undefined, user.id);

        // Lock account if too many attempts
        if (newFailedAttempts >= this.MAX_LOGIN_ATTEMPTS) {
          updateData.lockedUntil = new Date(Date.now() + this.LOCKOUT_DURATION_MINUTES * 60 * 1000);
          this.logger.warn(`Account locked for user ${email} due to too many failed attempts`);

          // Audit log: account locked
          await this.securityAudit.logAccountLocked(user.id, email);
        }

        await this.userRepository.update(user.id, updateData);
        throw new InvalidCredentialsException();
      }

      // Check email verification
      if (!user.emailVerified) {
        throw new EmailNotVerifiedException();
      }

      // Check if OTP is enabled - if so, send OTP and return early
      if (user.otpEnabled) {
        await this.sendLoginOtp(user);
        return {
          should_show_email_otp_screen: true,
          message: 'OTP sent to your email'
        };
      }

      // Reset failed attempts on successful login and update lastLoginAt
      const loginTime = new Date();
      await this.userRepository.update(user.id, {
        failedLoginAttempts: 0,
        lockedUntil: undefined,
        lastLoginAt: loginTime
      });

      // Audit log: successful login
      await this.securityAudit.logLoginSuccess(user.id, email);

      // Get exchange keys (only extra call needed - user data already fetched)
      const exchanges = await this.user.getExchangeKeysForUser(user.id);

      // Build user response from already-fetched data (avoids second DB query)
      const userData = {
        ...user,
        passwordHash: undefined, // Remove sensitive field
        failedLoginAttempts: 0,
        lockedUntil: undefined,
        lastLoginAt: loginTime,
        rememberMe,
        exchanges
      };

      return {
        user: userData,
        access_token: null, // Will be generated by RefreshTokenService
        message: 'Login successful'
      };
    } catch (error: unknown) {
      if (error instanceof AppException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : '';
      if (errorMessage === 'bad user credentials' || errorMessage === 'user not found') {
        throw new InvalidCredentialsException();
      }
      // Log the unexpected error and throw a generic message
      this.logger.error(`Authentication error: ${errorMessage || 'Unknown error'}`);
      throw new InternalException('Authentication failed. Please try again later.');
    }
  }

  private async sendLoginOtp(user: User) {
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

  public validateAPIKey(key: string) {
    const APIKey = this.config.get('CHANSEY_API_KEY');
    if (key === APIKey) return true;
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
      otpHash: undefined,
      otpExpiresAt: undefined,
      otpFailedAttempts: 0,
      failedLoginAttempts: 0,
      lockedUntil: undefined,
      lastLoginAt: new Date()
    });

    // Audit log: OTP verified and login success
    await this.securityAudit.logLoginSuccess(user.id, user.email);

    // Get full user data
    const userData = await this.user.getById(user.id);
    userData.roles = user.roles;

    return {
      user: userData,
      access_token: null, // Will be generated by controller
      message: 'OTP verified successfully'
    };
  }

  public async resendOtp(email: string) {
    const user = await this.userRepository.findOne({
      where: { email },
      select: ['id', 'email', 'given_name', 'otpEnabled']
    });

    if (!user) {
      return { message: 'If an account exists, an OTP will be sent.' };
    }

    await this.sendLoginOtp(user as User);
    return { message: 'OTP sent successfully' };
  }

  public async changePassword(user: User, changePasswordData: ChangePasswordDto) {
    try {
      const { old_password, new_password, confirm_new_password } = changePasswordData;

      if (new_password !== confirm_new_password) {
        throw new PasswordMismatchException('New password and confirmation do not match');
      }

      // Get user with password hash
      const dbUser = await this.userRepository.findOne({
        where: { id: user.id },
        select: ['id', 'passwordHash']
      });

      if (!dbUser?.passwordHash) {
        throw new ValidationException('Cannot verify current password');
      }

      // Verify old password
      const isValid = await this.password.verifyPassword(old_password, dbUser.passwordHash);
      if (!isValid) {
        throw new InvalidCredentialsException('Current password is incorrect');
      }

      // Hash and save new password
      const newPasswordHash = await this.password.hashPassword(new_password);
      await this.userRepository.update(user.id, { passwordHash: newPasswordHash });

      // Audit log: password changed
      await this.securityAudit.logPasswordChanged(user.id, user.email);

      return { message: 'Password changed successfully' };
    } catch (error: unknown) {
      if (error instanceof AppException) {
        throw error;
      }
      throw new InternalException('Failed to change password. Please try again later.');
    }
  }

  public async forgotPassword(email: string) {
    const user = await this.userRepository.findOne({
      where: { email },
      select: ['id', 'email', 'given_name']
    });

    // Always return success message to prevent email enumeration
    if (!user) {
      return { message: 'If an account exists with this email, a password reset link will be sent.' };
    }

    const resetToken = this.password.generateSecureToken();
    const resetTokenExpiresAt = this.password.getPasswordResetExpiration();

    await this.userRepository.update(user.id, {
      passwordResetToken: resetToken,
      passwordResetTokenExpiresAt: resetTokenExpiresAt
    });

    const emailSent = await this.email.sendPasswordResetEmail(email, resetToken, user.given_name);
    if (!emailSent) {
      this.logger.warn(`Failed to send password reset email to ${email}`);
    }

    // Audit log: password reset requested
    await this.securityAudit.logPasswordResetRequested(email);

    return { message: 'If an account exists with this email, a password reset link will be sent.' };
  }

  public async resetPassword(token: string, newPassword: string, confirmPassword: string) {
    if (newPassword !== confirmPassword) {
      throw new PasswordMismatchException();
    }

    const user = await this.userRepository.findOne({
      where: { passwordResetToken: token },
      select: ['id', 'email', 'passwordResetTokenExpiresAt']
    });

    if (!user) {
      throw new InvalidTokenException('reset');
    }

    if (user.passwordResetTokenExpiresAt && user.passwordResetTokenExpiresAt < new Date()) {
      throw new TokenExpiredException('reset');
    }

    const passwordHash = await this.password.hashPassword(newPassword);

    await this.userRepository.update(user.id, {
      passwordHash,
      passwordResetToken: undefined,
      passwordResetTokenExpiresAt: undefined,
      failedLoginAttempts: 0,
      lockedUntil: undefined
    });

    // Audit log: password reset completed
    await this.securityAudit.logPasswordResetCompleted(user.id, user.email);

    return { message: 'Password reset successfully' };
  }

  public async enableOtp(userId: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'email']
    });

    await this.userRepository.update(userId, { otpEnabled: true });

    // Audit log: OTP enabled
    if (user) {
      await this.securityAudit.logOtpEnabled(userId, user.email);
    }

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
