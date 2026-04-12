import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { type Job } from 'bullmq';

import { NotificationEventType } from '@chansey/api-interfaces';

import { EmailNotificationService } from './channels/email-notification.service';
import { PushNotificationService } from './channels/push-notification.service';
import { SmsNotificationService } from './channels/sms-notification.service';
import { Notification } from './entities/notification.entity';
import { type NotificationJobData } from './interfaces/notification-events.interface';
import { NotificationProcessor } from './notification.processor';

import { FailedJobService } from '../failed-jobs/failed-job.service';

function makeJobData(overrides: Partial<NotificationJobData> = {}): NotificationJobData {
  return {
    userId: 'user-1',
    userEmail: 'test@example.com',
    userName: 'Test',
    eventType: NotificationEventType.TRADE_EXECUTED,
    title: 'Trade Executed',
    body: 'BUY 1 BTC',
    severity: 'info',
    channels: ['email', 'push'],
    payload: { userId: 'user-1', action: 'BUY', symbol: 'BTC/USD', quantity: 1, price: 50000, exchangeName: 'Binance' },
    ...overrides
  };
}

describe('NotificationProcessor', () => {
  let processor: NotificationProcessor;
  let notifRepo: { save: jest.Mock };
  let emailService: { send: jest.Mock };
  let pushService: { send: jest.Mock };
  let smsService: { send: jest.Mock };

  beforeEach(async () => {
    notifRepo = { save: jest.fn().mockResolvedValue({ id: 'notif-1' }) };
    emailService = { send: jest.fn().mockResolvedValue(true) };
    pushService = { send: jest.fn().mockResolvedValue(true) };
    smsService = { send: jest.fn().mockResolvedValue(true) };

    const module = await Test.createTestingModule({
      providers: [
        NotificationProcessor,
        { provide: getRepositoryToken(Notification), useValue: notifRepo },
        { provide: EmailNotificationService, useValue: emailService },
        { provide: PushNotificationService, useValue: pushService },
        { provide: SmsNotificationService, useValue: smsService },
        { provide: FailedJobService, useValue: { recordFailure: jest.fn() } }
      ]
    }).compile();

    processor = module.get(NotificationProcessor);
  });

  it('persists an in-app notification', async () => {
    const data = makeJobData();
    await processor.process({ id: 'job-1', data } as Job<NotificationJobData>);

    expect(notifRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        eventType: NotificationEventType.TRADE_EXECUTED,
        title: 'Trade Executed',
        read: false
      })
    );
  });

  it('dispatches to correct channels', async () => {
    const data = makeJobData({ channels: ['email', 'push'] });
    await processor.process({ id: 'job-1', data } as Job<NotificationJobData>);

    expect(emailService.send).toHaveBeenCalledWith(data);
    expect(pushService.send).toHaveBeenCalledWith(data);
    expect(smsService.send).not.toHaveBeenCalled();
  });

  it('channel failure does not block others', async () => {
    emailService.send.mockRejectedValue(new Error('SMTP down'));
    const data = makeJobData({ channels: ['email', 'push'] });

    await processor.process({ id: 'job-1', data } as Job<NotificationJobData>);

    expect(pushService.send).toHaveBeenCalledWith(data);
  });

  it('dispatches channels even when DB save fails', async () => {
    notifRepo.save.mockRejectedValue(new Error('DB connection lost'));
    const data = makeJobData({ channels: ['email'] });

    await processor.process({ id: 'job-1', data } as Job<NotificationJobData>);

    expect(emailService.send).toHaveBeenCalledWith(data);
  });

  it('completes without throwing when all channels fail', async () => {
    emailService.send.mockRejectedValue(new Error('SMTP down'));
    pushService.send.mockRejectedValue(new Error('FCM down'));
    const data = makeJobData({ channels: ['email', 'push'] });

    await expect(processor.process({ id: 'job-1', data } as Job<NotificationJobData>)).resolves.toBeUndefined();
  });
});
