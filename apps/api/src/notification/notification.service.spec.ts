import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { NotificationEventType, type NotificationPreferences } from '@chansey/api-interfaces';

import { NOTIFICATION_REDIS } from './notification-redis.provider';
import { NotificationService } from './notification.service';

import { User } from '../users/users.entity';

const DEFAULT_PREFS: NotificationPreferences = {
  channels: { email: true, push: false, sms: false },
  events: {
    trade_executed: true,
    trade_error: true,
    risk_breach: true,
    drift_alert: true,
    trading_halted: true,
    daily_summary: true,
    strategy_deployed: true,
    strategy_demoted: true,
    daily_loss_limit: true
  },
  quietHours: { enabled: false, startHourUtc: 22, endHourUtc: 7 }
};

function makeUser(overrides: Partial<User> = {}): Partial<User> {
  return {
    id: 'user-1',
    email: 'test@example.com',
    given_name: 'Test',
    notificationPreferences: { ...DEFAULT_PREFS },
    ...overrides
  };
}

function atUtcHour(hour: number, fn: () => void): void {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(`2026-01-01T${String(hour).padStart(2, '0')}:00:00Z`));
  try {
    fn();
  } finally {
    jest.useRealTimers();
  }
}

describe('NotificationService', () => {
  let service: NotificationService;
  let userRepo: { findOneBy: jest.Mock; findOneByOrFail: jest.Mock; update: jest.Mock };
  let queue: { add: jest.Mock };
  let redis: { set: jest.Mock };

  beforeEach(async () => {
    userRepo = {
      findOneBy: jest.fn(),
      findOneByOrFail: jest.fn(),
      update: jest.fn()
    };
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    redis = { set: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: 'BullQueue_notification', useValue: queue },
        { provide: NOTIFICATION_REDIS, useValue: redis }
      ]
    }).compile();

    service = module.get(NotificationService);
  });

  // ─── isQuietHours ────────────────────────────────────────

  describe('isQuietHours', () => {
    it('returns false when quiet hours disabled', () => {
      const prefs = { ...DEFAULT_PREFS, quietHours: { enabled: false, startHourUtc: 22, endHourUtc: 7 } };
      expect(service.isQuietHours(prefs)).toBe(false);
    });

    it('detects simple range (9-17)', () => {
      atUtcHour(12, () => {
        const prefs = { ...DEFAULT_PREFS, quietHours: { enabled: true, startHourUtc: 9, endHourUtc: 17 } };
        expect(service.isQuietHours(prefs)).toBe(true);
      });
    });

    it('detects midnight wrap (22-7)', () => {
      atUtcHour(23, () => {
        const prefs = { ...DEFAULT_PREFS, quietHours: { enabled: true, startHourUtc: 22, endHourUtc: 7 } };
        expect(service.isQuietHours(prefs)).toBe(true);
      });
    });

    it('returns false at boundary end (exclusive)', () => {
      atUtcHour(17, () => {
        const prefs = { ...DEFAULT_PREFS, quietHours: { enabled: true, startHourUtc: 9, endHourUtc: 17 } };
        expect(service.isQuietHours(prefs)).toBe(false);
      });
    });

    it('returns true at boundary start (inclusive)', () => {
      atUtcHour(9, () => {
        const prefs = { ...DEFAULT_PREFS, quietHours: { enabled: true, startHourUtc: 9, endHourUtc: 17 } };
        expect(service.isQuietHours(prefs)).toBe(true);
      });
    });
  });

  // ─── isRateLimited ──────────────────────────────────────

  describe('isRateLimited', () => {
    it('returns false (not limited) when Redis SET NX returns OK', async () => {
      redis.set.mockResolvedValue('OK');
      const result = await service.isRateLimited('user-1', NotificationEventType.TRADE_EXECUTED);
      expect(result).toBe(false);
      expect(redis.set).toHaveBeenCalledWith('notif:rl:user-1:trade_executed', '1', 'EX', 300, 'NX');
    });

    it('returns true (rate limited) when Redis SET NX returns null', async () => {
      redis.set.mockResolvedValue(null);
      const result = await service.isRateLimited('user-1', NotificationEventType.TRADE_EXECUTED);
      expect(result).toBe(true);
    });
  });

  // ─── send ───────────────────────────────────────────────

  describe('send', () => {
    const payload = {
      userId: 'user-1',
      action: 'BUY' as const,
      symbol: 'BTC/USD',
      quantity: 1,
      price: 50000,
      exchangeName: 'Binance'
    };

    it('does nothing when user not found', async () => {
      userRepo.findOneBy.mockResolvedValue(null);

      await service.send('user-1', NotificationEventType.TRADE_EXECUTED, 'Trade', 'body', 'info', payload);

      expect(queue.add).not.toHaveBeenCalled();
    });

    it('skips when event type is disabled', async () => {
      const user = makeUser({
        notificationPreferences: {
          ...DEFAULT_PREFS,
          events: { ...DEFAULT_PREFS.events, trade_executed: false }
        }
      });
      userRepo.findOneBy.mockResolvedValue(user);

      await service.send('user-1', NotificationEventType.TRADE_EXECUTED, 'Trade', 'body', 'info', payload);

      expect(queue.add).not.toHaveBeenCalled();
    });

    it('skips when rate limited', async () => {
      userRepo.findOneBy.mockResolvedValue(makeUser());
      redis.set.mockResolvedValue(null); // rate limited

      await service.send('user-1', NotificationEventType.TRADE_EXECUTED, 'Trade', 'body', 'info', payload);

      expect(queue.add).not.toHaveBeenCalled();
    });

    it('bypasses rate limit for critical severity', async () => {
      userRepo.findOneBy.mockResolvedValue(makeUser());
      redis.set.mockResolvedValue(null); // would be rate limited

      await service.send('user-1', NotificationEventType.RISK_BREACH, 'Risk', 'body', 'critical', {
        userId: 'user-1',
        metric: 'drawdown',
        threshold: 0.15,
        actual: 0.25
      });

      expect(queue.add).toHaveBeenCalled();
    });

    it('enqueues notification job with correct shape', async () => {
      userRepo.findOneBy.mockResolvedValue(makeUser());
      redis.set.mockResolvedValue('OK');

      await service.send('user-1', NotificationEventType.TRADE_EXECUTED, 'Trade', 'body', 'info', payload);

      expect(queue.add).toHaveBeenCalledWith(
        'send-notification',
        {
          userId: 'user-1',
          userEmail: 'test@example.com',
          userName: 'Test',
          eventType: NotificationEventType.TRADE_EXECUTED,
          title: 'Trade',
          body: 'body',
          severity: 'info',
          channels: ['email'],
          payload
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 100, removeOnFail: 500 }
      );
    });

    it('uses "Trader" as fallback when given_name is missing', async () => {
      userRepo.findOneBy.mockResolvedValue(makeUser({ given_name: undefined }));
      redis.set.mockResolvedValue('OK');

      await service.send('user-1', NotificationEventType.TRADE_EXECUTED, 'Trade', 'body', 'info', payload);

      expect(queue.add).toHaveBeenCalledWith(
        'send-notification',
        expect.objectContaining({ userName: 'Trader' }),
        expect.any(Object)
      );
    });

    it('suppresses email/sms but allows push during quiet hours', async () => {
      const user = makeUser({
        notificationPreferences: {
          ...DEFAULT_PREFS,
          channels: { email: true, push: true, sms: true },
          quietHours: { enabled: true, startHourUtc: 22, endHourUtc: 7 }
        }
      });
      userRepo.findOneBy.mockResolvedValue(user);
      redis.set.mockResolvedValue('OK');

      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-01-01T23:00:00Z'));

      await service.send('user-1', NotificationEventType.TRADE_EXECUTED, 'Trade', 'body', 'info', payload);

      jest.useRealTimers();

      expect(queue.add).toHaveBeenCalledWith(
        'send-notification',
        expect.objectContaining({ channels: ['push'] }),
        expect.any(Object)
      );
    });

    it('sends all channels for critical severity during quiet hours', async () => {
      const user = makeUser({
        notificationPreferences: {
          ...DEFAULT_PREFS,
          channels: { email: true, push: true, sms: true },
          quietHours: { enabled: true, startHourUtc: 22, endHourUtc: 7 }
        }
      });
      userRepo.findOneBy.mockResolvedValue(user);
      redis.set.mockResolvedValue(null); // would be rate limited too

      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-01-01T23:00:00Z'));

      await service.send('user-1', NotificationEventType.RISK_BREACH, 'Risk', 'body', 'critical', {
        userId: 'user-1',
        metric: 'drawdown',
        threshold: 0.15,
        actual: 0.25
      });

      jest.useRealTimers();

      expect(queue.add).toHaveBeenCalledWith(
        'send-notification',
        expect.objectContaining({ channels: ['email', 'push', 'sms'] }),
        expect.any(Object)
      );
    });

    it('catches errors without rethrowing', async () => {
      userRepo.findOneBy.mockRejectedValue(new Error('DB down'));

      await expect(
        service.send('user-1', NotificationEventType.TRADE_EXECUTED, 'Trade', 'body', 'info', payload)
      ).resolves.toBeUndefined();
    });
  });

  // ─── updatePreferences ──────────────────────────────────

  describe('updatePreferences', () => {
    it('merges partial preferences', async () => {
      userRepo.findOneBy.mockResolvedValue(makeUser());
      userRepo.update.mockResolvedValue(undefined);

      const result = await service.updatePreferences('user-1', { channels: { email: false, push: true, sms: false } });

      expect(result.channels.email).toBe(false);
      expect(result.channels.push).toBe(true);
      expect(userRepo.update).toHaveBeenCalledWith('user-1', {
        notificationPreferences: expect.objectContaining({
          channels: { email: false, push: true, sms: false }
        })
      });
    });

    it('throws when user not found', async () => {
      userRepo.findOneBy.mockResolvedValue(null);

      await expect(service.updatePreferences('user-1', {})).rejects.toThrow('User user-1 not found');
    });
  });

  // ─── getPreferences ─────────────────────────────────────

  describe('getPreferences', () => {
    it('returns user notification preferences', async () => {
      userRepo.findOneByOrFail.mockResolvedValue(makeUser());

      const result = await service.getPreferences('user-1');

      expect(result).toEqual(DEFAULT_PREFS);
      expect(userRepo.findOneByOrFail).toHaveBeenCalledWith({ id: 'user-1' });
    });
  });
});
