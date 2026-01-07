import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { SecurityAuditService } from './audit';
import { VerifyOtpDto } from './dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { PasswordService } from './password.service';

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
        throw new HttpException('User with this email already exists', HttpStatus.CONFLICT);
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
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(`Registration error: ${error instanceof Error ? error.message : 'Unknown error'}`);

      throw new HttpException(
        'Registration failed: ' + (error?.message || 'Unknown error occurred'),
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  public async verifyEmail(token: string) {
    const user = await this.userRepository.findOne({
      where: { emailVerificationToken: token },
      select: ['id', 'email', 'given_name', 'emailVerificationTokenExpiresAt']
    });

    if (!user) {
      throw new HttpException('Invalid verification token', HttpStatus.BAD_REQUEST);
    }

    if (user.emailVerificationTokenExpiresAt && user.emailVerificationTokenExpiresAt < new Date()) {
      throw new HttpException('Verification token has expired', HttpStatus.BAD_REQUEST);
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
        throw new HttpException('Wrong credentials provided', HttpStatus.BAD_REQUEST);
      }

      // Check if account is locked
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        const minutesRemaining = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
        throw new HttpException(
          `Account is locked. Try again in ${minutesRemaining} minutes.`,
          HttpStatus.TOO_MANY_REQUESTS
        );
      }

      // Check if password hash exists (for migrated users who might not have one yet)
      if (!user.passwordHash) {
        throw new HttpException('Please reset your password to continue', HttpStatus.BAD_REQUEST);
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
        throw new HttpException('Wrong credentials provided', HttpStatus.BAD_REQUEST);
      }

      // Check email verification
      if (!user.emailVerified) {
        throw new HttpException('Please verify your email before logging in', HttpStatus.FORBIDDEN);
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
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (error?.message === 'bad user credentials' || error?.message === 'user not found') {
        throw new HttpException('Wrong credentials provided', HttpStatus.BAD_REQUEST);
      } else {
        // Log the unexpected error and throw a generic message
        this.logger.error(`Authentication error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        throw new HttpException(
          'Authentication failed: ' + (error?.message || 'Unknown error occurred'),
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }
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
      throw new HttpException('Invalid OTP', HttpStatus.BAD_REQUEST);
    }

    // Check if OTP attempts are locked out
    if (user.otpFailedAttempts >= this.MAX_OTP_ATTEMPTS) {
      throw new HttpException('Too many failed OTP attempts. Please request a new code.', HttpStatus.TOO_MANY_REQUESTS);
    }

    if (user.otpExpiresAt && user.otpExpiresAt < new Date()) {
      throw new HttpException('OTP has expired', HttpStatus.BAD_REQUEST);
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
      throw new HttpException('Invalid OTP', HttpStatus.BAD_REQUEST);
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
        throw new HttpException('New password and confirmation do not match', HttpStatus.BAD_REQUEST);
      }

      // Get user with password hash
      const dbUser = await this.userRepository.findOne({
        where: { id: user.id },
        select: ['id', 'passwordHash']
      });

      if (!dbUser?.passwordHash) {
        throw new HttpException('Cannot verify current password', HttpStatus.BAD_REQUEST);
      }

      // Verify old password
      const isValid = await this.password.verifyPassword(old_password, dbUser.passwordHash);
      if (!isValid) {
        throw new HttpException('Current password is incorrect', HttpStatus.BAD_REQUEST);
      }

      // Hash and save new password
      const newPasswordHash = await this.password.hashPassword(new_password);
      await this.userRepository.update(user.id, { passwordHash: newPasswordHash });

      // Audit log: password changed
      await this.securityAudit.logPasswordChanged(user.id, user.email);

      return { message: 'Password changed successfully' };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to change password: ' + (error?.message || 'Unknown error occurred'),
        HttpStatus.INTERNAL_SERVER_ERROR
      );
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
      throw new HttpException('Passwords do not match', HttpStatus.BAD_REQUEST);
    }

    const user = await this.userRepository.findOne({
      where: { passwordResetToken: token },
      select: ['id', 'email', 'passwordResetTokenExpiresAt']
    });

    if (!user) {
      throw new HttpException('Invalid reset token', HttpStatus.BAD_REQUEST);
    }

    if (user.passwordResetTokenExpiresAt && user.passwordResetTokenExpiresAt < new Date()) {
      throw new HttpException('Reset token has expired', HttpStatus.BAD_REQUEST);
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
      throw new HttpException('Cannot verify password', HttpStatus.BAD_REQUEST);
    }

    const isValid = await this.password.verifyPassword(password, user.passwordHash);
    if (!isValid) {
      throw new HttpException('Invalid password', HttpStatus.BAD_REQUEST);
    }

    await this.userRepository.update(userId, { otpEnabled: false });

    // Audit log: OTP disabled
    await this.securityAudit.logOtpDisabled(userId, user.email);

    return { message: 'OTP disabled successfully' };
  }
}
