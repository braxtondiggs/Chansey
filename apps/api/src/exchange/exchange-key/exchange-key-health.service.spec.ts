import { NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import * as ccxt from 'ccxt';

import { ExchangeKeyHealthLog } from './exchange-key-health-log.entity';
import { ExchangeKeyHealthService } from './exchange-key-health.service';
import { ExchangeKey } from './exchange-key.entity';

import { EmailService } from '../../email/email.service';
import { UsersService } from '../../users/users.service';
import { ExchangeManagerService } from '../exchange-manager.service';

describe('ExchangeKeyHealthService', () => {
  let service: ExchangeKeyHealthService;
  let exchangeKeyRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let healthLogRepo: {
    save: jest.Mock;
    create: jest.Mock;
    findAndCount: jest.Mock;
    delete: jest.Mock;
  };
  let exchangeManager: { getExchangeClient: jest.Mock };
  let emailService: { sendExchangeKeyWarningEmail: jest.Mock; sendExchangeKeyDeactivatedEmail: jest.Mock };
  let usersService: { getById: jest.Mock };

  const mockUser = { id: 'user-1', email: 'test@example.com', given_name: 'Test' };

  const createMockKey = (overrides: Partial<ExchangeKey> = {}): ExchangeKey =>
    ({
      id: 'key-1',
      userId: 'user-1',
      exchangeId: 'exchange-1',
      isActive: true,
      healthStatus: 'unknown',
      consecutiveFailures: 0,
      lastErrorCategory: null,
      lastErrorMessage: null,
      lastHealthCheckAt: null,
      deactivatedByHealthCheck: false,
      exchange: { id: 'exchange-1', name: 'Binance', slug: 'binance' },
      ...overrides
    }) as unknown as ExchangeKey;

  const createQueryBuilderMock = (consecutiveFailures: number) => {
    const qbMock = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ raw: [{ consecutiveFailures }] })
    };
    exchangeKeyRepo.createQueryBuilder.mockReturnValue(qbMock);
    return qbMock;
  };

  beforeEach(async () => {
    exchangeKeyRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      createQueryBuilder: jest.fn()
    };
    healthLogRepo = {
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      create: jest.fn().mockImplementation((data) => data),
      findAndCount: jest.fn(),
      delete: jest.fn()
    };
    exchangeManager = { getExchangeClient: jest.fn() };
    emailService = {
      sendExchangeKeyWarningEmail: jest.fn().mockResolvedValue(true),
      sendExchangeKeyDeactivatedEmail: jest.fn().mockResolvedValue(true)
    };
    usersService = { getById: jest.fn().mockResolvedValue(mockUser) };

    const moduleRef = {
      get: jest.fn().mockImplementation((token) => {
        if (token === EmailService) return emailService;
        if (token === UsersService) return usersService;
        return undefined;
      })
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExchangeKeyHealthService,
        { provide: getRepositoryToken(ExchangeKey), useValue: exchangeKeyRepo },
        { provide: getRepositoryToken(ExchangeKeyHealthLog), useValue: healthLogRepo },
        { provide: ExchangeManagerService, useValue: exchangeManager },
        { provide: ModuleRef, useValue: moduleRef }
      ]
    }).compile();

    service = module.get(ExchangeKeyHealthService);
    service.onModuleInit();
  });

  describe('classifyError', () => {
    it.each([
      ['PermissionDenied', new ccxt.PermissionDenied('denied'), 'permission'],
      ['AuthenticationError', new ccxt.AuthenticationError('bad key'), 'authentication'],
      ['InvalidNonce', new ccxt.InvalidNonce('nonce'), 'nonce'],
      ['ExchangeNotAvailable', new ccxt.ExchangeNotAvailable('down'), 'exchange_down'],
      ['RateLimitExceeded', new ccxt.RateLimitExceeded('slow'), 'rate_limit'],
      ['NetworkError', new ccxt.NetworkError('timeout'), 'network'],
      ['generic Error', new Error('something'), 'unknown']
    ])('classifies %s as %s', (_label, error, expected) => {
      expect(service.classifyError(error)).toBe(expected);
    });
  });

  describe('checkKeyHealth', () => {
    it('resets counters on healthy check', async () => {
      const key = createMockKey({ consecutiveFailures: 2, healthStatus: 'unhealthy' });
      exchangeManager.getExchangeClient.mockResolvedValue({ fetchBalance: jest.fn().mockResolvedValue({}) });

      await service.checkKeyHealth(key);

      expect(key.healthStatus).toBe('healthy');
      expect(key.consecutiveFailures).toBe(0);
      expect(key.lastErrorCategory).toBeNull();
      expect(exchangeKeyRepo.save).toHaveBeenCalledWith(key);
      expect(healthLogRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'healthy', errorCategory: null })
      );
    });

    it('returns early when user is not found', async () => {
      const key = createMockKey();
      usersService.getById.mockResolvedValue(null);

      await service.checkKeyHealth(key);

      expect(exchangeManager.getExchangeClient).not.toHaveBeenCalled();
      expect(exchangeKeyRepo.save).not.toHaveBeenCalled();
    });

    it('triggers warning notification at warning threshold (consecutiveFailures === 3)', async () => {
      const key = createMockKey({ consecutiveFailures: 2 });
      exchangeManager.getExchangeClient.mockRejectedValue(new ccxt.AuthenticationError('invalid'));
      createQueryBuilderMock(3);

      await service.checkKeyHealth(key);

      expect(key.healthStatus).toBe('warning');
      expect(key.consecutiveFailures).toBe(3);
      expect(emailService.sendExchangeKeyWarningEmail).toHaveBeenCalledWith(
        mockUser.email,
        mockUser.given_name,
        'Binance',
        3
      );
    });

    it('sets warning status without notification between thresholds (consecutiveFailures === 4)', async () => {
      const key = createMockKey({ consecutiveFailures: 3 });
      exchangeManager.getExchangeClient.mockRejectedValue(new ccxt.AuthenticationError('invalid'));
      createQueryBuilderMock(4);

      await service.checkKeyHealth(key);

      expect(key.healthStatus).toBe('warning');
      expect(key.consecutiveFailures).toBe(4);
      expect(emailService.sendExchangeKeyWarningEmail).not.toHaveBeenCalled();
      expect(emailService.sendExchangeKeyDeactivatedEmail).not.toHaveBeenCalled();
    });

    it('deactivates key at deactivation threshold (consecutiveFailures === 5)', async () => {
      const key = createMockKey({ consecutiveFailures: 4 });
      exchangeManager.getExchangeClient.mockRejectedValue(new ccxt.AuthenticationError('invalid'));
      createQueryBuilderMock(5);

      await service.checkKeyHealth(key);

      expect(key.isActive).toBe(false);
      expect(key.deactivatedByHealthCheck).toBe(true);
      expect(key.healthStatus).toBe('deactivated');
      expect(emailService.sendExchangeKeyDeactivatedEmail).toHaveBeenCalledWith(
        mockUser.email,
        mockUser.given_name,
        'Binance'
      );
    });

    it('sets unhealthy for deactivation-eligible errors below warning threshold', async () => {
      const key = createMockKey({ consecutiveFailures: 0 });
      exchangeManager.getExchangeClient.mockRejectedValue(new ccxt.AuthenticationError('invalid'));
      createQueryBuilderMock(1);

      await service.checkKeyHealth(key);

      expect(key.healthStatus).toBe('unhealthy');
      expect(key.consecutiveFailures).toBe(1);
      expect(emailService.sendExchangeKeyWarningEmail).not.toHaveBeenCalled();
    });

    it('does not increment counter for transient errors', async () => {
      const key = createMockKey({ consecutiveFailures: 1 });
      exchangeManager.getExchangeClient.mockRejectedValue(new ccxt.RateLimitExceeded('slow down'));

      await service.checkKeyHealth(key);

      expect(exchangeKeyRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(key.consecutiveFailures).toBe(1);
      expect(key.healthStatus).toBe('unhealthy');
    });

    it('keeps warning status for transient errors when already above warning threshold', async () => {
      const key = createMockKey({ consecutiveFailures: 3 });
      exchangeManager.getExchangeClient.mockRejectedValue(new ccxt.NetworkError('timeout'));

      await service.checkKeyHealth(key);

      expect(exchangeKeyRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(key.healthStatus).toBe('warning');
    });

    it('skips key with no exchange slug', async () => {
      const key = createMockKey({ exchange: undefined as any });

      await service.checkKeyHealth(key);

      expect(exchangeManager.getExchangeClient).not.toHaveBeenCalled();
      expect(exchangeKeyRepo.save).not.toHaveBeenCalled();
    });

    it('does not send notification email when user has no email', async () => {
      const key = createMockKey({ consecutiveFailures: 4 });
      exchangeManager.getExchangeClient.mockRejectedValue(new ccxt.PermissionDenied('denied'));
      createQueryBuilderMock(5);
      usersService.getById.mockResolvedValue({ id: 'user-1', email: null, given_name: null });

      await service.checkKeyHealth(key);

      expect(key.healthStatus).toBe('deactivated');
      expect(emailService.sendExchangeKeyDeactivatedEmail).not.toHaveBeenCalled();
    });

    it('still deactivates key when notification email fails', async () => {
      const key = createMockKey({ consecutiveFailures: 4 });
      exchangeManager.getExchangeClient.mockRejectedValue(new ccxt.AuthenticationError('invalid'));
      createQueryBuilderMock(5);
      emailService.sendExchangeKeyDeactivatedEmail.mockRejectedValue(new Error('SMTP failure'));

      await service.checkKeyHealth(key);

      expect(key.isActive).toBe(false);
      expect(key.deactivatedByHealthCheck).toBe(true);
      expect(key.healthStatus).toBe('deactivated');
      expect(exchangeKeyRepo.save).toHaveBeenCalled();
    });
  });

  describe('checkAllKeys', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('groups by exchange and processes all keys', async () => {
      const key1 = createMockKey({ id: 'key-1', exchangeId: 'ex-1' });
      const key2 = createMockKey({ id: 'key-2', exchangeId: 'ex-2' });
      const key3 = createMockKey({ id: 'key-3', exchangeId: 'ex-1' });

      exchangeKeyRepo.find.mockResolvedValue([key1, key2, key3]);
      exchangeManager.getExchangeClient.mockResolvedValue({ fetchBalance: jest.fn().mockResolvedValue({}) });

      const resultPromise = service.checkAllKeys();
      await jest.advanceTimersByTimeAsync(10000);
      const result = await resultPromise;

      expect(result.total).toBe(3);
      expect(result.healthy).toBe(3);
      expect(result.unhealthy).toBe(0);
      expect(result.deactivated).toBe(0);
    });

    it('returns empty results when no keys exist', async () => {
      exchangeKeyRepo.find.mockResolvedValue([]);

      const result = await service.checkAllKeys();

      expect(result).toEqual({ total: 0, healthy: 0, unhealthy: 0, deactivated: 0 });
    });

    it('counts unhealthy when checkKeyHealth throws for a key', async () => {
      const key1 = createMockKey({ id: 'key-1', exchangeId: 'ex-1' });
      const key2 = createMockKey({ id: 'key-2', exchangeId: 'ex-1' });

      exchangeKeyRepo.find.mockResolvedValue([key1, key2]);

      const checkSpy = jest.spyOn(service, 'checkKeyHealth');
      checkSpy.mockImplementationOnce(async (key) => {
        key.healthStatus = 'healthy';
      });
      checkSpy.mockRejectedValueOnce(new Error('fatal'));

      const resultPromise = service.checkAllKeys();
      await jest.advanceTimersByTimeAsync(10000);
      const result = await resultPromise;

      expect(result.total).toBe(2);
      expect(result.healthy).toBe(1);
      expect(result.unhealthy).toBe(1);
    });
  });

  describe('getHealthSummary', () => {
    it('returns mapped health summary for user keys', async () => {
      const key = createMockKey({
        healthStatus: 'healthy',
        lastHealthCheckAt: new Date('2026-01-01'),
        consecutiveFailures: 0
      });
      exchangeKeyRepo.find.mockResolvedValue([key]);

      const result = await service.getHealthSummary('user-1');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(
        expect.objectContaining({
          id: 'key-1',
          healthStatus: 'healthy',
          exchange: { id: 'exchange-1', name: 'Binance', slug: 'binance' },
          isActive: true
        })
      );
    });

    it('returns fallback exchange info when exchange relation is missing', async () => {
      const key = createMockKey({ exchange: undefined as any, exchangeId: 'ex-orphan' });
      exchangeKeyRepo.find.mockResolvedValue([key]);

      const result = await service.getHealthSummary('user-1');

      expect(result[0].exchange).toEqual({ id: 'ex-orphan', name: '', slug: '' });
    });
  });

  describe('getHealthHistory', () => {
    it('returns paginated health logs for owned key', async () => {
      const key = createMockKey();
      exchangeKeyRepo.findOne.mockResolvedValue(key);

      const mockLog = {
        id: 'log-1',
        status: 'healthy',
        errorCategory: null,
        errorMessage: null,
        responseTimeMs: 150,
        checkedAt: new Date('2026-01-01')
      };
      healthLogRepo.findAndCount.mockResolvedValue([[mockLog], 1]);

      const result = await service.getHealthHistory('key-1', 'user-1', 1, 10);

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(exchangeKeyRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'key-1', userId: 'user-1' }
      });
    });

    it('throws NotFoundException when key does not belong to user', async () => {
      exchangeKeyRepo.findOne.mockResolvedValue(null);

      await expect(service.getHealthHistory('key-1', 'other-user', 1, 10)).rejects.toThrow(NotFoundException);
    });
  });

  describe('cleanupOldLogs', () => {
    it('deletes logs older than retention period and returns count', async () => {
      healthLogRepo.delete.mockResolvedValue({ affected: 42 });

      const result = await service.cleanupOldLogs(90);

      expect(result).toBe(42);
      expect(healthLogRepo.delete).toHaveBeenCalledWith(expect.objectContaining({ checkedAt: expect.any(Object) }));
    });
  });
});
