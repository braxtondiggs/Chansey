import { ConfigService } from '@nestjs/config';

import { Resend } from 'resend';

import { EmailService } from './email.service';

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {
      send: jest.fn()
    }
  }))
}));

describe('EmailService', () => {
  let service: EmailService;
  let configService: { get: jest.Mock };
  let sendMock: jest.Mock;

  beforeEach(() => {
    configService = {
      get: jest.fn((key: string, fallback?: string) => {
        const values: Record<string, string> = {
          RESEND_API_KEY: 'api-key',
          RESEND_FROM_EMAIL: 'noreply@test.com',
          FRONTEND_URL: 'https://frontend.test'
        };
        return values[key] ?? fallback;
      })
    };

    service = new EmailService(configService as unknown as ConfigService);
    sendMock = (service as any).resend.emails.send as jest.Mock;
    sendMock.mockReset();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('initializes Resend with the API key', () => {
    expect(Resend).toHaveBeenCalledWith('api-key');
  });

  it('sends emails using Resend and returns true on success', async () => {
    sendMock.mockResolvedValue({ data: { id: 'email-id' }, error: null });

    const result = await service.sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Test</p>',
      text: 'Test'
    });

    expect(result).toBe(true);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Cymbit Trading <noreply@test.com>',
        to: 'user@example.com',
        subject: 'Hello',
        html: '<p>Test</p>',
        text: 'Test'
      })
    );
  });

  it('returns false when Resend returns an error', async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: 'bad send' } });

    const result = await service.sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Test</p>'
    });

    expect(result).toBe(false);
  });

  it('returns false when Resend throws', async () => {
    sendMock.mockRejectedValue(new Error('boom'));

    const result = await service.sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Test</p>'
    });

    expect(result).toBe(false);
  });

  it('builds verification email content with the frontend URL', async () => {
    const sendEmailSpy = jest.spyOn(service, 'sendEmail').mockResolvedValue(true);

    await service.sendVerificationEmail('user@example.com', 'token-123', 'Sam');

    expect(sendEmailSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Verify your Cymbit Trading account',
        html: expect.stringContaining('https://frontend.test/auth/verify-email?token=token-123')
      })
    );
  });

  it('builds OTP email content with the provided code', async () => {
    const sendEmailSpy = jest.spyOn(service, 'sendEmail').mockResolvedValue(true);

    await service.sendOtpEmail('user@example.com', '123456', 'Sam');

    expect(sendEmailSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Your Cymbit Trading verification code',
        html: expect.stringContaining('123456')
      })
    );
  });
});
