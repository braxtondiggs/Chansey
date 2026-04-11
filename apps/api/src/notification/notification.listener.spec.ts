import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { NotificationEventType, Role } from '@chansey/api-interfaces';

import type {
  DailySummaryNotification,
  RegimeStaleNotification,
  RiskBreachNotification,
  TradeExecutedNotification,
  TradingHaltedNotification
} from './interfaces/notification-events.interface';
import { NotificationListener } from './notification.listener';
import { NotificationService } from './notification.service';

import { User } from '../users/users.entity';

describe('NotificationListener', () => {
  let listener: NotificationListener;
  let notificationService: { send: jest.Mock };
  let userRepo: { createQueryBuilder: jest.Mock };

  const adminUsers = [
    { id: 'admin-1', email: 'admin1@test.com', roles: [Role.ADMIN] },
    { id: 'admin-2', email: 'admin2@test.com', roles: [Role.ADMIN] }
  ] as Partial<User>[];

  function makeQueryBuilder(result: Partial<User>[]) {
    return {
      where: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(result)
    };
  }

  beforeEach(async () => {
    notificationService = { send: jest.fn().mockResolvedValue(undefined) };
    userRepo = { createQueryBuilder: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        NotificationListener,
        { provide: NotificationService, useValue: notificationService },
        { provide: getRepositoryToken(User), useValue: userRepo }
      ]
    }).compile();

    listener = module.get(NotificationListener);
  });

  describe('handleTradeExecuted', () => {
    it('should send notification with formatted message', async () => {
      const payload: TradeExecutedNotification = {
        userId: 'user-1',
        action: 'BUY',
        symbol: 'BTC',
        quantity: 0.5,
        price: 42000.123,
        exchangeName: 'Binance'
      };

      await listener.handleTradeExecuted(payload);

      expect(notificationService.send).toHaveBeenCalledWith(
        'user-1',
        NotificationEventType.TRADE_EXECUTED,
        'Trade Executed: BUY BTC',
        'BUY 0.5 BTC at $42000.12 on Binance',
        'info',
        payload
      );
    });

    it('should not throw when send fails', async () => {
      notificationService.send.mockRejectedValue(new Error('fail'));

      await expect(
        listener.handleTradeExecuted({
          userId: 'u',
          action: 'BUY',
          symbol: 'X',
          quantity: 1,
          price: 1,
          exchangeName: 'E'
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('handleRiskBreach', () => {
    it('should include strategyName when provided', async () => {
      const payload: RiskBreachNotification = {
        userId: 'user-1',
        metric: 'maxDrawdown',
        threshold: 20,
        actual: 25,
        strategyName: 'RSI-Momentum'
      };

      await listener.handleRiskBreach(payload);

      expect(notificationService.send).toHaveBeenCalledWith(
        'user-1',
        NotificationEventType.RISK_BREACH,
        'Risk Breach: maxDrawdown',
        'maxDrawdown exceeded threshold (20) with value 25 on RSI-Momentum',
        'critical',
        payload
      );
    });

    it('should omit strategyName when not provided', async () => {
      const payload: RiskBreachNotification = {
        userId: 'user-1',
        metric: 'maxDrawdown',
        threshold: 20,
        actual: 25
      };

      await listener.handleRiskBreach(payload);

      expect(notificationService.send).toHaveBeenCalledWith(
        'user-1',
        NotificationEventType.RISK_BREACH,
        'Risk Breach: maxDrawdown',
        'maxDrawdown exceeded threshold (20) with value 25',
        'critical',
        payload
      );
    });
  });

  describe('handleTradingHalted', () => {
    it('should include strategyName when provided', async () => {
      const payload: TradingHaltedNotification = {
        userId: 'user-1',
        reason: 'Risk limit exceeded',
        strategyName: 'RSI-Momentum'
      };

      await listener.handleTradingHalted(payload);

      expect(notificationService.send).toHaveBeenCalledWith(
        'user-1',
        NotificationEventType.TRADING_HALTED,
        'Trading Halted',
        'Trading has been halted: Risk limit exceeded (RSI-Momentum)',
        'critical',
        payload
      );
    });

    it('should omit strategyName when not provided', async () => {
      const payload: TradingHaltedNotification = {
        userId: 'user-1',
        reason: 'Manual halt'
      };

      await listener.handleTradingHalted(payload);

      expect(notificationService.send).toHaveBeenCalledWith(
        'user-1',
        NotificationEventType.TRADING_HALTED,
        'Trading Halted',
        'Trading has been halted: Manual halt',
        'critical',
        payload
      );
    });
  });

  describe('handleDailySummary', () => {
    it('should include P&L when provided', async () => {
      const payload: DailySummaryNotification = {
        userId: 'user-1',
        totalTrades: 10,
        totalAlerts: 3,
        criticalAlerts: 1,
        pnl: 150.456
      };

      await listener.handleDailySummary(payload);

      expect(notificationService.send).toHaveBeenCalledWith(
        'user-1',
        NotificationEventType.DAILY_SUMMARY,
        'Daily Trading Summary',
        'Today: 10 trades, 3 alerts (1 critical) | P&L: $150.46',
        'info',
        payload
      );
    });

    it('should omit P&L when undefined', async () => {
      const payload: DailySummaryNotification = {
        userId: 'user-1',
        totalTrades: 0,
        totalAlerts: 0,
        criticalAlerts: 0
      };

      await listener.handleDailySummary(payload);

      expect(notificationService.send).toHaveBeenCalledWith(
        'user-1',
        NotificationEventType.DAILY_SUMMARY,
        'Daily Trading Summary',
        'Today: 0 trades, 0 alerts (0 critical)',
        'info',
        payload
      );
    });
  });

  describe('handleRegimeStale', () => {
    const payload: RegimeStaleNotification = {
      lastRefreshAt: new Date('2026-04-10T10:00:00Z'),
      consecutiveFailures: 3,
      cachedRegime: 'BULL'
    };

    it('should notify all admin users with correct body', async () => {
      userRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder(adminUsers));

      await listener.handleRegimeStale(payload);

      expect(userRepo.createQueryBuilder).toHaveBeenCalledWith('user');
      expect(notificationService.send).toHaveBeenCalledTimes(2);

      const expectedBody = expect.stringContaining('3 consecutive refresh failures');
      for (const admin of adminUsers) {
        expect(notificationService.send).toHaveBeenCalledWith(
          admin.id,
          NotificationEventType.REGIME_STALE,
          'Market Regime Data Stale',
          expectedBody,
          'critical',
          payload
        );
      }
    });

    it('should handle null lastRefreshAt with "never" text', async () => {
      const nullPayload: RegimeStaleNotification = {
        lastRefreshAt: null,
        consecutiveFailures: 5,
        cachedRegime: 'NONE'
      };
      userRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder([adminUsers[0]]));

      await listener.handleRegimeStale(nullPayload);

      expect(notificationService.send).toHaveBeenCalledWith(
        'admin-1',
        NotificationEventType.REGIME_STALE,
        'Market Regime Data Stale',
        expect.stringContaining('last successful refresh: never'),
        'critical',
        nullPayload
      );
    });

    it('should handle lastRefreshAt as string', async () => {
      const stringPayload: RegimeStaleNotification = {
        lastRefreshAt: '2026-04-10T10:00:00Z' as unknown as Date,
        consecutiveFailures: 1,
        cachedRegime: 'BEAR'
      };
      userRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder([adminUsers[0]]));

      await listener.handleRegimeStale(stringPayload);

      expect(notificationService.send).toHaveBeenCalledWith(
        'admin-1',
        NotificationEventType.REGIME_STALE,
        'Market Regime Data Stale',
        expect.stringContaining('2026-04-10T10:00:00.000Z'),
        'critical',
        stringPayload
      );
    });

    it('should not throw when notification service fails', async () => {
      userRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder(adminUsers));
      notificationService.send.mockRejectedValue(new Error('Send failed'));

      await expect(listener.handleRegimeStale(payload)).resolves.toBeUndefined();
    });

    it('should not throw when user query fails', async () => {
      userRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockRejectedValue(new Error('DB error'))
      });

      await expect(listener.handleRegimeStale(payload)).resolves.toBeUndefined();
    });

    it('should handle no admin users gracefully', async () => {
      userRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder([]));

      await listener.handleRegimeStale(payload);

      expect(notificationService.send).not.toHaveBeenCalled();
    });
  });
});
