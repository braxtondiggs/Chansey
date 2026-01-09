import { ConfigService } from '@nestjs/config';

import * as bcrypt from 'bcrypt';

import { PasswordService } from './password.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn()
}));

describe('PasswordService', () => {
  let service: PasswordService;
  let bcryptMock: jest.Mocked<typeof bcrypt>;
  let configService: { get: jest.Mock };

  beforeEach(() => {
    configService = {
      get: jest.fn((_: string, fallback: number) => fallback)
    };

    service = new PasswordService(configService as unknown as ConfigService);
    bcryptMock = bcrypt as jest.Mocked<typeof bcrypt>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('hashes passwords with 12 salt rounds', async () => {
    bcryptMock.hash.mockResolvedValue('hashed-password' as never);

    const result = await service.hashPassword('plain');

    expect(result).toBe('hashed-password');
    expect(bcryptMock.hash).toHaveBeenCalledWith('plain', 12);
  });

  it('verifies passwords using bcrypt compare', async () => {
    bcryptMock.compare.mockResolvedValue(true as never);

    const result = await service.verifyPassword('plain', 'hash');

    expect(result).toBe(true);
    expect(bcryptMock.compare).toHaveBeenCalledWith('plain', 'hash');
  });

  it('generates secure tokens as 64-character hex strings', () => {
    const token = service.generateSecureToken();

    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates 6-digit OTP codes', () => {
    const otp = service.generateOtp();

    expect(otp).toMatch(/^\d{6}$/);
  });

  it('hashes OTPs with 6 salt rounds', async () => {
    bcryptMock.hash.mockResolvedValue('otp-hash' as never);

    const result = await service.hashOtp('123456');

    expect(result).toBe('otp-hash');
    expect(bcryptMock.hash).toHaveBeenCalledWith('123456', 6);
  });

  it('calculates OTP expiration 10 minutes from now', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    const result = service.getOtpExpiration();

    expect(result.getTime()).toBe(1_700_000_000_000 + 10 * 60 * 1000);
    nowSpy.mockRestore();
  });

  it('calculates verification token expiration 24 hours from now', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    const result = service.getVerificationTokenExpiration();

    expect(result.getTime()).toBe(1_700_000_000_000 + 24 * 60 * 60 * 1000);
    nowSpy.mockRestore();
  });

  it('calculates password reset expiration 1 hour from now', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    const result = service.getPasswordResetExpiration();

    expect(result.getTime()).toBe(1_700_000_000_000 + 60 * 60 * 1000);
    nowSpy.mockRestore();
  });
});
