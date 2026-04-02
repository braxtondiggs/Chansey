import { Repository } from 'typeorm';

import { Role } from '@chansey/api-interfaces';

import { SecurityAuditService } from './audit';
import { AuthenticationService } from './authentication.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { OtpService } from './otp.service';
import { PasswordService } from './password.service';

import {
  AccountLockedException,
  EmailAlreadyExistsException,
  EmailNotVerifiedException,
  InternalException,
  InvalidCredentialsException,
  InvalidTokenException,
  PasswordMismatchException,
  TokenExpiredException,
  ValidationException
} from '../common/exceptions';
import { EmailService } from '../email/email.service';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { User } from '../users/users.entity';
import { UsersService } from '../users/users.service';

jest.mock('uuid', () => ({
  v4: () => 'user-id-123'
}));

describe('AuthenticationService', () => {
  let service: AuthenticationService;
  let userRepository: jest.Mocked<Repository<User>>;
  let configService: { get: jest.Mock };
  let usersService: jest.Mocked<UsersService>;
  let passwordService: jest.Mocked<PasswordService>;
  let emailService: jest.Mocked<EmailService>;
  let securityAudit: jest.Mocked<SecurityAuditService>;
  let otpService: jest.Mocked<OtpService>;

  beforeEach(() => {
    userRepository = {
      findOne: jest.fn(),
      update: jest.fn()
    } as unknown as jest.Mocked<Repository<User>>;

    configService = { get: jest.fn() };

    usersService = {
      create: jest.fn(),
      getById: jest.fn(),
      getExchangeKeysForUser: jest.fn()
    } as unknown as jest.Mocked<UsersService>;

    passwordService = {
      hashPassword: jest.fn(),
      verifyPassword: jest.fn(),
      generateSecureToken: jest.fn(),
      getVerificationTokenExpiration: jest.fn(),
      generateOtp: jest.fn(),
      hashOtp: jest.fn(),
      getOtpExpiration: jest.fn(),
      verifyOtp: jest.fn(),
      getPasswordResetExpiration: jest.fn()
    } as unknown as jest.Mocked<PasswordService>;

    emailService = {
      sendVerificationEmail: jest.fn(),
      sendWelcomeEmail: jest.fn(),
      sendOtpEmail: jest.fn(),
      sendPasswordResetEmail: jest.fn()
    } as unknown as jest.Mocked<EmailService>;

    securityAudit = {
      logRegistration: jest.fn(),
      logLoginFailed: jest.fn(),
      logLoginSuccess: jest.fn(),
      logAccountLocked: jest.fn(),
      logOtpFailed: jest.fn(),
      logPasswordChanged: jest.fn(),
      logPasswordResetRequested: jest.fn(),
      logPasswordResetCompleted: jest.fn()
    } as unknown as jest.Mocked<SecurityAuditService>;

    otpService = {
      sendLoginOtp: jest.fn()
    } as unknown as jest.Mocked<OtpService>;

    service = new AuthenticationService(
      userRepository,
      configService as any,
      usersService,
      passwordService,
      emailService,
      securityAudit,
      otpService
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    const payload: CreateUserDto = {
      email: 'user@example.com',
      given_name: 'Sam',
      family_name: 'Stone',
      password: 'pass123',
      confirm_password: 'pass123'
    };

    it('rejects when user already exists', async () => {
      userRepository.findOne.mockResolvedValue({ id: 'existing-user' } as User);

      await expect(service.register(payload)).rejects.toThrow(EmailAlreadyExistsException);
    });

    it('creates user with hashed password and sends verification email', async () => {
      userRepository.findOne.mockResolvedValue(null);
      passwordService.hashPassword.mockResolvedValue('hashed-password');
      passwordService.generateSecureToken.mockReturnValue('verify-token');
      const expiresAt = new Date('2024-01-01T00:00:00Z');
      passwordService.getVerificationTokenExpiration.mockReturnValue(expiresAt);

      usersService.create.mockResolvedValue({
        id: 'user-id-123',
        email: 'user@example.com',
        given_name: 'Sam',
        family_name: 'Stone',
        exchanges: []
      } as any);
      emailService.sendVerificationEmail.mockResolvedValue(true);

      const result = await service.register(payload);

      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'user@example.com',
          passwordHash: 'hashed-password',
          emailVerified: false,
          emailVerificationToken: 'verify-token',
          emailVerificationTokenExpiresAt: expiresAt,
          roles: [Role.USER]
        })
      );
      expect(emailService.sendVerificationEmail).toHaveBeenCalledWith('user@example.com', 'verify-token', 'Sam');
      expect(securityAudit.logRegistration).toHaveBeenCalledWith('user-id-123', 'user@example.com');
      expect(result.message).toContain('Registration successful');
      expect(result.user).toEqual(expect.objectContaining({ id: 'user-id-123', email: 'user@example.com' }));
    });

    it('wraps unexpected errors in InternalException', async () => {
      userRepository.findOne.mockRejectedValue(new Error('DB connection failed'));

      await expect(service.register(payload)).rejects.toThrow(InternalException);
    });
  });

  describe('verifyEmail', () => {
    it('rejects invalid verification token', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.verifyEmail('bad-token')).rejects.toThrow(InvalidTokenException);
    });

    it('rejects expired verification token', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 'user-id',
        email: 'user@example.com',
        emailVerificationTokenExpiresAt: new Date(Date.now() - 60_000)
      } as User);

      await expect(service.verifyEmail('expired-token')).rejects.toThrow(TokenExpiredException);
    });

    it('marks email as verified and sends welcome email', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 'user-id',
        email: 'user@example.com',
        given_name: 'Sam',
        emailVerificationTokenExpiresAt: new Date(Date.now() + 60_000)
      } as User);
      emailService.sendWelcomeEmail.mockResolvedValue(true);

      const result = await service.verifyEmail('good-token');

      expect(userRepository.update).toHaveBeenCalledWith('user-id', {
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationTokenExpiresAt: null
      });
      expect(emailService.sendWelcomeEmail).toHaveBeenCalledWith('user@example.com', 'Sam');
      expect(result).toEqual({ message: 'Email verified successfully' });
    });
  });

  describe('resendVerificationEmail', () => {
    it('returns generic message when user not found (anti-enumeration)', async () => {
      userRepository.findOne.mockResolvedValue(null);

      const result = await service.resendVerificationEmail('unknown@example.com');

      expect(result.message).toContain('If an account exists');
      expect(emailService.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('returns early when email is already verified', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 'user-id',
        email: 'user@example.com',
        emailVerified: true
      } as User);

      const result = await service.resendVerificationEmail('user@example.com');

      expect(result.message).toBe('Email is already verified');
      expect(userRepository.update).not.toHaveBeenCalled();
    });

    it('generates new token and sends verification email', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 'user-id',
        email: 'user@example.com',
        given_name: 'Sam',
        emailVerified: false
      } as User);
      passwordService.generateSecureToken.mockReturnValue('new-token');
      const expiresAt = new Date('2024-01-01T00:00:00Z');
      passwordService.getVerificationTokenExpiration.mockReturnValue(expiresAt);
      emailService.sendVerificationEmail.mockResolvedValue(true);

      const result = await service.resendVerificationEmail('user@example.com');

      expect(userRepository.update).toHaveBeenCalledWith('user-id', {
        emailVerificationToken: 'new-token',
        emailVerificationTokenExpiresAt: expiresAt
      });
      expect(emailService.sendVerificationEmail).toHaveBeenCalledWith('user@example.com', 'new-token', 'Sam');
      expect(result).toEqual({ message: 'Verification email sent' });
    });
  });

  describe('getAuthenticatedUser', () => {
    const verifiedUser = {
      id: 'user-id',
      email: 'user@example.com',
      given_name: 'Sam',
      family_name: 'Stone',
      passwordHash: 'hash',
      emailVerified: true,
      otpEnabled: false,
      failedLoginAttempts: 0,
      roles: [Role.USER]
    } as unknown as User;

    it('rejects when user not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.getAuthenticatedUser('unknown@example.com', 'pass')).rejects.toThrow(
        InvalidCredentialsException
      );
    });

    it('rejects when account is locked', async () => {
      userRepository.findOne.mockResolvedValue({
        ...verifiedUser,
        lockedUntil: new Date(Date.now() + 600_000)
      } as User);

      await expect(service.getAuthenticatedUser('user@example.com', 'pass')).rejects.toThrow(AccountLockedException);
    });

    it('rejects when user has no password hash (migrated user)', async () => {
      userRepository.findOne.mockResolvedValue({
        ...verifiedUser,
        passwordHash: undefined
      } as unknown as User);

      await expect(service.getAuthenticatedUser('user@example.com', 'pass')).rejects.toThrow(ValidationException);
    });

    it('increments failed attempts on wrong password without locking', async () => {
      userRepository.findOne.mockResolvedValue({
        ...verifiedUser,
        failedLoginAttempts: 2
      } as User);
      passwordService.verifyPassword.mockResolvedValue(false);

      await expect(service.getAuthenticatedUser('user@example.com', 'wrong')).rejects.toThrow(
        InvalidCredentialsException
      );

      expect(securityAudit.logLoginFailed).toHaveBeenCalled();
      expect(userRepository.update).toHaveBeenCalledWith(
        'user-id',
        expect.objectContaining({ failedLoginAttempts: 3 })
      );
      expect(securityAudit.logAccountLocked).not.toHaveBeenCalled();
    });

    it('locks account after max failed login attempts', async () => {
      userRepository.findOne.mockResolvedValue({
        ...verifiedUser,
        failedLoginAttempts: 4
      } as User);
      passwordService.verifyPassword.mockResolvedValue(false);

      await expect(service.getAuthenticatedUser('user@example.com', 'wrong')).rejects.toThrow(
        InvalidCredentialsException
      );

      expect(userRepository.update).toHaveBeenCalledWith(
        'user-id',
        expect.objectContaining({
          failedLoginAttempts: 5,
          lockedUntil: expect.any(Date)
        })
      );
      expect(securityAudit.logAccountLocked).toHaveBeenCalledWith('user-id', 'user@example.com');
    });

    it('rejects when email is not verified', async () => {
      userRepository.findOne.mockResolvedValue({
        ...verifiedUser,
        emailVerified: false
      } as User);
      passwordService.verifyPassword.mockResolvedValue(true);

      await expect(service.getAuthenticatedUser('user@example.com', 'pass')).rejects.toThrow(EmailNotVerifiedException);
    });

    it('sends OTP and returns early when OTP is enabled', async () => {
      userRepository.findOne.mockResolvedValue({
        ...verifiedUser,
        otpEnabled: true
      } as User);
      passwordService.verifyPassword.mockResolvedValue(true);
      otpService.sendLoginOtp.mockResolvedValue(undefined);

      const result = await service.getAuthenticatedUser('user@example.com', 'pass');

      expect(otpService.sendLoginOtp).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-id', email: 'user@example.com' })
      );
      expect(result).toEqual({
        should_show_email_otp_screen: true,
        message: 'OTP sent to your email'
      });
    });

    it('returns user data and resets failed attempts on successful login', async () => {
      userRepository.findOne.mockResolvedValue({ ...verifiedUser } as User);
      passwordService.verifyPassword.mockResolvedValue(true);
      usersService.getExchangeKeysForUser.mockResolvedValue([]);

      const result = await service.getAuthenticatedUser('user@example.com', 'pass');

      expect(userRepository.update).toHaveBeenCalledWith(
        'user-id',
        expect.objectContaining({
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastLoginAt: expect.any(Date)
        })
      );
      expect(securityAudit.logLoginSuccess).toHaveBeenCalledWith('user-id', 'user@example.com');
      expect(result).toEqual(
        expect.objectContaining({
          message: 'Login successful',
          access_token: null
        })
      );
    });
  });

  describe('validateAPIKey', () => {
    it('returns true for matching key', () => {
      configService.get.mockReturnValue('secret-key');
      expect(service.validateAPIKey('secret-key')).toBe(true);
    });

    it('returns false for non-matching key', () => {
      configService.get.mockReturnValue('secret-key');
      expect(service.validateAPIKey('wrong-key')).toBe(false);
    });
  });

  describe('changePassword', () => {
    const user = { id: 'user-id', email: 'user@example.com' } as User;

    it('rejects when new passwords do not match', async () => {
      const payload: ChangePasswordDto = {
        old_password: 'old',
        new_password: 'new1',
        confirm_new_password: 'new2'
      };

      await expect(service.changePassword(user, payload)).rejects.toThrow(PasswordMismatchException);
    });

    it('rejects when current password is wrong', async () => {
      userRepository.findOne.mockResolvedValue({ id: 'user-id', passwordHash: 'hash' } as User);
      passwordService.verifyPassword.mockResolvedValue(false);

      const payload: ChangePasswordDto = {
        old_password: 'wrong',
        new_password: 'new',
        confirm_new_password: 'new'
      };

      await expect(service.changePassword(user, payload)).rejects.toThrow(InvalidCredentialsException);
    });

    it('updates password hash and audits on success', async () => {
      userRepository.findOne.mockResolvedValue({ id: 'user-id', passwordHash: 'hash' } as User);
      passwordService.verifyPassword.mockResolvedValue(true);
      passwordService.hashPassword.mockResolvedValue('new-hash');

      const payload: ChangePasswordDto = {
        old_password: 'old',
        new_password: 'new',
        confirm_new_password: 'new'
      };

      const result = await service.changePassword(user, payload);

      expect(userRepository.update).toHaveBeenCalledWith('user-id', { passwordHash: 'new-hash' });
      expect(securityAudit.logPasswordChanged).toHaveBeenCalledWith('user-id', 'user@example.com');
      expect(result).toEqual({ message: 'Password changed successfully' });
    });
  });

  describe('forgotPassword', () => {
    it('returns generic message when user not found (anti-enumeration)', async () => {
      userRepository.findOne.mockResolvedValue(null);

      const result = await service.forgotPassword('unknown@example.com');

      expect(result.message).toContain('If an account exists');
      expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('generates reset token and sends email for existing user', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 'user-id',
        email: 'user@example.com',
        given_name: 'Sam'
      } as User);
      passwordService.generateSecureToken.mockReturnValue('reset-token');
      const expiresAt = new Date('2024-02-01T00:00:00Z');
      passwordService.getPasswordResetExpiration.mockReturnValue(expiresAt);
      emailService.sendPasswordResetEmail.mockResolvedValue(true);

      const result = await service.forgotPassword('user@example.com');

      expect(userRepository.update).toHaveBeenCalledWith('user-id', {
        passwordResetToken: 'reset-token',
        passwordResetTokenExpiresAt: expiresAt
      });
      expect(emailService.sendPasswordResetEmail).toHaveBeenCalledWith('user@example.com', 'reset-token', 'Sam');
      expect(securityAudit.logPasswordResetRequested).toHaveBeenCalledWith('user@example.com');
      expect(result.message).toContain('If an account exists');
    });
  });

  describe('resetPassword', () => {
    it('rejects when passwords do not match', async () => {
      await expect(service.resetPassword('token', 'new1', 'new2')).rejects.toThrow(PasswordMismatchException);
    });

    it('rejects invalid reset token', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.resetPassword('bad-token', 'new', 'new')).rejects.toThrow(InvalidTokenException);
    });

    it('rejects expired reset token', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 'user-id',
        passwordResetTokenExpiresAt: new Date(Date.now() - 60_000)
      } as User);

      await expect(service.resetPassword('token', 'new', 'new')).rejects.toThrow(TokenExpiredException);
    });

    it('resets password and clears lockout on success', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 'user-id',
        email: 'user@example.com',
        passwordResetTokenExpiresAt: new Date(Date.now() + 60_000)
      } as User);
      passwordService.hashPassword.mockResolvedValue('new-hash');

      const result = await service.resetPassword('token', 'new', 'new');

      expect(userRepository.update).toHaveBeenCalledWith('user-id', {
        passwordHash: 'new-hash',
        passwordResetToken: null,
        passwordResetTokenExpiresAt: null,
        failedLoginAttempts: 0,
        lockedUntil: null
      });
      expect(securityAudit.logPasswordResetCompleted).toHaveBeenCalledWith('user-id', 'user@example.com');
      expect(result).toEqual({ message: 'Password reset successfully' });
    });
  });
});
