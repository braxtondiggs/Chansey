import { HttpException, HttpStatus } from '@nestjs/common';

import { Repository } from 'typeorm';

import { SecurityAuditService } from './audit';
import { AuthenticationService } from './authentication.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { PasswordService } from './password.service';

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

  beforeEach(() => {
    userRepository = {
      findOne: jest.fn(),
      update: jest.fn()
    } as unknown as jest.Mocked<Repository<User>>;

    configService = {
      get: jest.fn()
    };

    usersService = {
      create: jest.fn(),
      getById: jest.fn()
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
      logAccountLocked: jest.fn(),
      logOtpFailed: jest.fn(),
      logPasswordChanged: jest.fn()
    } as unknown as jest.Mocked<SecurityAuditService>;

    service = new AuthenticationService(
      userRepository,
      configService as any,
      usersService,
      passwordService,
      emailService,
      securityAudit
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('rejects registration when user already exists', async () => {
    userRepository.findOne.mockResolvedValue({ id: 'existing-user' } as User);

    const payload: CreateUserDto = {
      email: 'user@example.com',
      given_name: 'Sam',
      family_name: 'Stone',
      password: 'pass123',
      confirm_password: 'pass123'
    };

    await expect(service.register(payload)).rejects.toThrow('User with this email already exists');
  });

  it('registers new users and sends verification email', async () => {
    userRepository.findOne.mockResolvedValue(null);
    passwordService.hashPassword.mockResolvedValue('hashed-password');
    passwordService.generateSecureToken.mockReturnValue('verify-token');
    const verificationExpiresAt = new Date('2024-01-01T00:00:00Z');
    passwordService.getVerificationTokenExpiration.mockReturnValue(verificationExpiresAt);

    usersService.create.mockResolvedValue({
      id: 'user-id-123',
      email: 'user@example.com',
      given_name: 'Sam',
      family_name: 'Stone'
    } as User);

    emailService.sendVerificationEmail.mockResolvedValue(true);

    const payload: CreateUserDto = {
      email: 'user@example.com',
      given_name: 'Sam',
      family_name: 'Stone',
      password: 'pass123',
      confirm_password: 'pass123'
    };

    const result = await service.register(payload);

    expect(securityAudit.logRegistration).toHaveBeenCalledWith('user-id-123', 'user@example.com');
    expect(usersService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'user-id-123',
        email: 'user@example.com',
        given_name: 'Sam',
        family_name: 'Stone',
        passwordHash: 'hashed-password',
        emailVerified: false,
        emailVerificationToken: 'verify-token',
        roles: ['user']
      })
    );
    expect(emailService.sendVerificationEmail).toHaveBeenCalledWith('user@example.com', 'verify-token', 'Sam');
    expect(result).toEqual(
      expect.objectContaining({
        message: 'Registration successful. Please check your email to verify your account.',
        user: {
          id: 'user-id-123',
          email: 'user@example.com',
          given_name: 'Sam',
          family_name: 'Stone'
        }
      })
    );
  });

  it('rejects email verification with invalid token', async () => {
    userRepository.findOne.mockResolvedValue(null);

    await expect(service.verifyEmail('bad-token')).rejects.toThrow('Invalid verification token');
  });

  it('verifies email and sends welcome email', async () => {
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
      emailVerificationToken: undefined,
      emailVerificationTokenExpiresAt: undefined
    });
    expect(emailService.sendWelcomeEmail).toHaveBeenCalledWith('user@example.com', 'Sam');
    expect(result).toEqual({ message: 'Email verified successfully' });
  });

  it('resends verification email when user is not verified', async () => {
    userRepository.findOne.mockResolvedValue({
      id: 'user-id',
      email: 'user@example.com',
      given_name: 'Sam',
      emailVerified: false
    } as User);

    passwordService.generateSecureToken.mockReturnValue('new-token');
    const verificationExpiresAt = new Date('2024-01-01T00:00:00Z');
    passwordService.getVerificationTokenExpiration.mockReturnValue(verificationExpiresAt);
    emailService.sendVerificationEmail.mockResolvedValue(true);

    const result = await service.resendVerificationEmail('user@example.com');

    expect(userRepository.update).toHaveBeenCalledWith('user-id', {
      emailVerificationToken: 'new-token',
      emailVerificationTokenExpiresAt: verificationExpiresAt
    });
    expect(emailService.sendVerificationEmail).toHaveBeenCalledWith('user@example.com', 'new-token', 'Sam');
    expect(result).toEqual({ message: 'Verification email sent' });
  });

  it('locks the account after too many failed login attempts', async () => {
    userRepository.findOne.mockResolvedValue({
      id: 'user-id',
      email: 'user@example.com',
      passwordHash: 'hash',
      emailVerified: true,
      failedLoginAttempts: 4,
      roles: ['user']
    } as User);

    passwordService.verifyPassword.mockResolvedValue(false);

    await expect(service.getAuthenticatedUser('user@example.com', 'wrong')).rejects.toThrow(
      new HttpException('Wrong credentials provided', HttpStatus.BAD_REQUEST)
    );

    expect(securityAudit.logLoginFailed).toHaveBeenCalledWith(
      'user@example.com',
      'Invalid password',
      undefined,
      undefined,
      'user-id'
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

  it('returns OTP response when OTP is enabled', async () => {
    userRepository.findOne.mockResolvedValue({
      id: 'user-id',
      email: 'user@example.com',
      given_name: 'Sam',
      passwordHash: 'hash',
      emailVerified: true,
      otpEnabled: true,
      failedLoginAttempts: 0,
      roles: ['user']
    } as User);

    passwordService.verifyPassword.mockResolvedValue(true);
    passwordService.generateOtp.mockReturnValue('123456');
    passwordService.hashOtp.mockResolvedValue('otp-hash');
    const otpExpiresAt = new Date('2024-01-01T00:10:00Z');
    passwordService.getOtpExpiration.mockReturnValue(otpExpiresAt);
    emailService.sendOtpEmail.mockResolvedValue(true);

    const result = await service.getAuthenticatedUser('user@example.com', 'pass');

    expect(userRepository.update).toHaveBeenCalledWith('user-id', {
      otpHash: 'otp-hash',
      otpExpiresAt,
      otpFailedAttempts: 0
    });
    expect(emailService.sendOtpEmail).toHaveBeenCalledWith('user@example.com', '123456', 'Sam');
    expect(result).toEqual({
      should_show_email_otp_screen: true,
      message: 'OTP sent to your email'
    });
  });

  it('increments OTP failed attempts when verification fails', async () => {
    userRepository.findOne.mockResolvedValue({
      id: 'user-id',
      email: 'user@example.com',
      otpHash: 'otp-hash',
      otpExpiresAt: new Date(Date.now() + 60_000),
      otpFailedAttempts: 1,
      roles: ['user']
    } as User);

    passwordService.verifyOtp.mockResolvedValue(false);

    const payload: VerifyOtpDto = {
      email: 'user@example.com',
      otp: '000000'
    };

    await expect(service.verifyOtp(payload)).rejects.toThrow('Invalid OTP');
    expect(userRepository.update).toHaveBeenCalledWith('user-id', { otpFailedAttempts: 2 });
  });

  it('changes password when current password is valid', async () => {
    userRepository.findOne.mockResolvedValue({
      id: 'user-id',
      passwordHash: 'hash'
    } as User);

    passwordService.verifyPassword.mockResolvedValue(true);
    passwordService.hashPassword.mockResolvedValue('new-hash');

    const payload: ChangePasswordDto = {
      old_password: 'old',
      new_password: 'new',
      confirm_new_password: 'new'
    };

    const result = await service.changePassword({ id: 'user-id' } as User, payload);

    expect(userRepository.update).toHaveBeenCalledWith('user-id', { passwordHash: 'new-hash' });
    expect(result).toEqual({ message: 'Password changed successfully' });
  });

  it('rejects password reset when token is expired', async () => {
    userRepository.findOne.mockResolvedValue({
      id: 'user-id',
      passwordResetTokenExpiresAt: new Date(Date.now() - 60_000)
    } as User);

    await expect(service.resetPassword('token', 'new', 'new')).rejects.toThrow('Reset token has expired');
  });
});
