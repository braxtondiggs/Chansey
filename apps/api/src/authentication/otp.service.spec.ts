import { NotFoundException } from '@nestjs/common';

import { type Repository } from 'typeorm';

import { type SecurityAuditService } from './audit';
import { type VerifyOtpDto } from './dto/verify-otp.dto';
import { OtpService } from './otp.service';
import { type PasswordService } from './password.service';

import { type EmailService } from '../email/email.service';
import { type User } from '../users/users.entity';
import { type UsersService } from '../users/users.service';

const makeUser = (overrides: Partial<User> = {}): User =>
  ({
    id: 'user-id',
    email: 'user@example.com',
    given_name: 'Sam',
    family_name: 'Stone',
    otpHash: 'otp-hash',
    otpExpiresAt: new Date(Date.now() + 60_000),
    otpFailedAttempts: 0,
    roles: ['user'],
    ...overrides
  }) as User;

describe('OtpService', () => {
  let service: OtpService;
  let userRepository: jest.Mocked<Repository<User>>;
  let usersService: jest.Mocked<UsersService>;
  let passwordService: jest.Mocked<PasswordService>;
  let emailService: jest.Mocked<EmailService>;
  let securityAudit: jest.Mocked<SecurityAuditService>;

  beforeEach(() => {
    userRepository = {
      findOne: jest.fn(),
      update: jest.fn()
    } as unknown as jest.Mocked<Repository<User>>;

    usersService = {
      getById: jest.fn()
    } as unknown as jest.Mocked<UsersService>;

    passwordService = {
      generateOtp: jest.fn(),
      hashOtp: jest.fn(),
      getOtpExpiration: jest.fn(),
      getOtpLifetimeMs: jest.fn().mockReturnValue(600_000),
      verifyOtp: jest.fn(),
      verifyPassword: jest.fn()
    } as unknown as jest.Mocked<PasswordService>;

    emailService = {
      sendOtpEmail: jest.fn()
    } as unknown as jest.Mocked<EmailService>;

    securityAudit = {
      logOtpFailed: jest.fn(),
      logLoginSuccess: jest.fn(),
      logOtpEnabled: jest.fn(),
      logOtpDisabled: jest.fn()
    } as unknown as jest.Mocked<SecurityAuditService>;

    service = new OtpService(userRepository, usersService, passwordService, emailService, securityAudit);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sendLoginOtp', () => {
    it('generates OTP, hashes it, stores hash, and sends email', async () => {
      passwordService.generateOtp.mockReturnValue('123456');
      passwordService.hashOtp.mockResolvedValue('otp-hash');
      const otpExpiresAt = new Date('2024-01-01T00:10:00Z');
      passwordService.getOtpExpiration.mockReturnValue(otpExpiresAt);
      emailService.sendOtpEmail.mockResolvedValue(true);

      const user = makeUser();
      await service.sendLoginOtp(user);

      expect(userRepository.update).toHaveBeenCalledWith('user-id', {
        otpHash: 'otp-hash',
        otpExpiresAt,
        otpFailedAttempts: 0
      });
      expect(emailService.sendOtpEmail).toHaveBeenCalledWith('user@example.com', '123456', 'Sam');
    });

    it('does not throw when email delivery fails', async () => {
      passwordService.generateOtp.mockReturnValue('123456');
      passwordService.hashOtp.mockResolvedValue('otp-hash');
      passwordService.getOtpExpiration.mockReturnValue(new Date());
      emailService.sendOtpEmail.mockResolvedValue(false);

      await expect(service.sendLoginOtp(makeUser())).resolves.toBeUndefined();
      expect(userRepository.update).toHaveBeenCalled();
    });
  });

  describe('verifyOtp', () => {
    const validPayload: VerifyOtpDto = { email: 'user@example.com', otp: '123456' };

    it('clears OTP fields, audits login, and returns user with roles', async () => {
      userRepository.findOne.mockResolvedValue(makeUser());

      passwordService.verifyOtp.mockResolvedValue(true);
      usersService.getById.mockResolvedValue(makeUser({ otpHash: undefined, otpExpiresAt: undefined }) as any);

      const result = await service.verifyOtp(validPayload);

      expect(userRepository.update).toHaveBeenCalledWith('user-id', {
        otpHash: null,
        otpExpiresAt: null,
        otpFailedAttempts: 0,
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: expect.any(Date)
      });
      expect(securityAudit.logLoginSuccess).toHaveBeenCalledWith('user-id', 'user@example.com');
      expect(result).toEqual({
        user: expect.objectContaining({ id: 'user-id', roles: ['user'] }),
        message: 'OTP verified successfully'
      });
    });

    it('throws InvalidOtpException when user not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.verifyOtp(validPayload)).rejects.toThrow('Invalid OTP');
    });

    it('throws InvalidOtpException when user has no OTP hash', async () => {
      userRepository.findOne.mockResolvedValue(makeUser({ otpHash: null }));

      await expect(service.verifyOtp(validPayload)).rejects.toThrow('Invalid OTP');
    });

    it('increments failed attempts and audits when OTP is wrong', async () => {
      userRepository.findOne.mockResolvedValue(makeUser({ otpFailedAttempts: 1 }));
      passwordService.verifyOtp.mockResolvedValue(false);

      await expect(service.verifyOtp({ email: 'user@example.com', otp: '000000' })).rejects.toThrow('Invalid OTP');
      expect(userRepository.update).toHaveBeenCalledWith('user-id', { otpFailedAttempts: 2 });
      expect(securityAudit.logOtpFailed).toHaveBeenCalledWith(
        'user@example.com',
        'Invalid OTP code',
        undefined,
        undefined,
        'user-id'
      );
    });

    it('defaults null otpFailedAttempts to 0 before incrementing', async () => {
      userRepository.findOne.mockResolvedValue(makeUser({ otpFailedAttempts: null as any }));
      passwordService.verifyOtp.mockResolvedValue(false);

      await expect(service.verifyOtp(validPayload)).rejects.toThrow('Invalid OTP');
      expect(userRepository.update).toHaveBeenCalledWith('user-id', { otpFailedAttempts: 1 });
    });

    it('rejects expired OTP', async () => {
      userRepository.findOne.mockResolvedValue(makeUser({ otpExpiresAt: new Date(Date.now() - 60_000) }));

      await expect(service.verifyOtp(validPayload)).rejects.toThrow('OTP has expired');
    });

    it('proceeds when otpExpiresAt is null', async () => {
      userRepository.findOne.mockResolvedValue(makeUser({ otpExpiresAt: null }));
      passwordService.verifyOtp.mockResolvedValue(true);
      usersService.getById.mockResolvedValue(makeUser() as any);

      const result = await service.verifyOtp(validPayload);
      expect(result.message).toBe('OTP verified successfully');
    });

    it('rejects when max attempts exceeded', async () => {
      userRepository.findOne.mockResolvedValue(makeUser({ otpFailedAttempts: 3 }));

      await expect(service.verifyOtp(validPayload)).rejects.toThrow('Too many failed OTP attempts');
    });
  });

  describe('resendOtp', () => {
    it('sends OTP for existing user when cooldown has elapsed', async () => {
      // otpExpiresAt far enough in the past that cooldown (60s) has passed
      const oldExpiry = new Date(Date.now() - 120_000);
      userRepository.findOne.mockResolvedValue(makeUser({ otpEnabled: true, otpExpiresAt: oldExpiry } as any));

      passwordService.generateOtp.mockReturnValue('123456');
      passwordService.hashOtp.mockResolvedValue('otp-hash');
      passwordService.getOtpExpiration.mockReturnValue(new Date());
      emailService.sendOtpEmail.mockResolvedValue(true);

      const result = await service.resendOtp('user@example.com');
      expect(result).toEqual({ message: 'OTP sent successfully' });
      expect(emailService.sendOtpEmail).toHaveBeenCalled();
    });

    it('sends OTP when no previous OTP exists (otpExpiresAt is null)', async () => {
      userRepository.findOne.mockResolvedValue(makeUser({ otpEnabled: true, otpExpiresAt: null } as any));

      passwordService.generateOtp.mockReturnValue('123456');
      passwordService.hashOtp.mockResolvedValue('otp-hash');
      passwordService.getOtpExpiration.mockReturnValue(new Date());
      emailService.sendOtpEmail.mockResolvedValue(true);

      const result = await service.resendOtp('user@example.com');
      expect(result).toEqual({ message: 'OTP sent successfully' });
      expect(emailService.sendOtpEmail).toHaveBeenCalled();
    });

    it('returns generic message when cooldown has not elapsed', async () => {
      // OTP was sent very recently (otpExpiresAt = now + lifetime means sentAt = now)
      const recentExpiry = new Date(Date.now() + 600_000);
      userRepository.findOne.mockResolvedValue(makeUser({ otpEnabled: true, otpExpiresAt: recentExpiry } as any));

      const result = await service.resendOtp('user@example.com');
      expect(result).toEqual({ message: 'If an account exists, an OTP will be sent.' });
      expect(emailService.sendOtpEmail).not.toHaveBeenCalled();
    });

    it('returns generic message for non-existent user to prevent enumeration', async () => {
      userRepository.findOne.mockResolvedValue(null);

      const result = await service.resendOtp('unknown@example.com');
      expect(result).toEqual({ message: 'If an account exists, an OTP will be sent.' });
      expect(emailService.sendOtpEmail).not.toHaveBeenCalled();
    });
  });

  describe('enableOtp', () => {
    it('enables OTP and audits when user exists', async () => {
      userRepository.findOne.mockResolvedValue(makeUser());

      const result = await service.enableOtp('user-id');

      expect(userRepository.update).toHaveBeenCalledWith('user-id', { otpEnabled: true });
      expect(securityAudit.logOtpEnabled).toHaveBeenCalledWith('user-id', 'user@example.com');
      expect(result).toEqual({ message: 'OTP enabled successfully' });
    });

    it('throws NotFoundException when user not found in DB', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.enableOtp('user-id')).rejects.toThrow(NotFoundException);
      expect(userRepository.update).not.toHaveBeenCalled();
      expect(securityAudit.logOtpEnabled).not.toHaveBeenCalled();
    });
  });

  describe('disableOtp', () => {
    it('disables OTP with valid password and audits', async () => {
      userRepository.findOne.mockResolvedValue(makeUser({ passwordHash: 'hash' } as any));
      passwordService.verifyPassword.mockResolvedValue(true);

      const result = await service.disableOtp('user-id', 'password');

      expect(userRepository.update).toHaveBeenCalledWith('user-id', { otpEnabled: false });
      expect(securityAudit.logOtpDisabled).toHaveBeenCalledWith('user-id', 'user@example.com');
      expect(result).toEqual({ message: 'OTP disabled successfully' });
    });

    it('rejects with invalid password', async () => {
      userRepository.findOne.mockResolvedValue(makeUser({ passwordHash: 'hash' } as any));
      passwordService.verifyPassword.mockResolvedValue(false);

      await expect(service.disableOtp('user-id', 'wrong')).rejects.toThrow('Invalid password');
    });

    it('throws ValidationException when user has no password hash', async () => {
      userRepository.findOne.mockResolvedValue(makeUser({ passwordHash: null } as any));

      await expect(service.disableOtp('user-id', 'password')).rejects.toThrow('Cannot verify password');
    });

    it('throws ValidationException when user not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.disableOtp('user-id', 'password')).rejects.toThrow('Cannot verify password');
    });
  });
});
