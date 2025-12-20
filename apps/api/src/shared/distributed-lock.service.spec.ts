import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DistributedLockService } from './distributed-lock.service';

// Mock Redis
const createRedisMock = () => ({
  set: jest.fn(),
  get: jest.fn(),
  pttl: jest.fn(),
  eval: jest.fn(),
  quit: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn()
});

jest.mock('ioredis', () => {
  const RedisMockConstructor = jest.fn().mockImplementation(() => createRedisMock());
  return {
    __esModule: true,
    default: RedisMockConstructor
  };
});

// Create mock ConfigService
const createMockConfigService = (): jest.Mocked<ConfigService> =>
  ({
    get: jest.fn((key: string, defaultValue?: unknown) => {
      const config: Record<string, unknown> = {
        REDIS_HOST: 'localhost',
        REDIS_PORT: 6379,
        REDIS_USER: undefined,
        REDIS_PASSWORD: undefined,
        REDIS_TLS: 'false'
      };
      return config[key] ?? defaultValue;
    })
  }) as unknown as jest.Mocked<ConfigService>;

describe('DistributedLockService', () => {
  let service: DistributedLockService;
  let redisMock: ReturnType<typeof createRedisMock>;
  let mockConfigService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockConfigService = createMockConfigService();
    service = new DistributedLockService(mockConfigService);
    redisMock = (service as any).redis;
  });

  describe('acquire', () => {
    it('acquires lock when key is not held', async () => {
      redisMock.set.mockResolvedValue('OK');

      const result = await service.acquire({
        key: 'test-lock',
        ttlMs: 5000
      });

      expect(result.acquired).toBe(true);
      expect(result.lockId).toBeDefined();
      expect(result.lockId).toMatch(/^[0-9a-f-]{36}$/); // UUID format
      expect(redisMock.set).toHaveBeenCalledWith('test-lock', expect.any(String), 'PX', 5000, 'NX');
    });

    it('fails to acquire when lock is already held', async () => {
      redisMock.set.mockResolvedValue(null);

      const result = await service.acquire({
        key: 'test-lock',
        ttlMs: 5000
      });

      expect(result.acquired).toBe(false);
      expect(result.lockId).toBeNull();
    });

    it('retries acquisition based on maxRetries', async () => {
      redisMock.set.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce('OK');

      const result = await service.acquire({
        key: 'test-lock',
        ttlMs: 5000,
        maxRetries: 2,
        retryDelayMs: 10
      });

      expect(result.acquired).toBe(true);
      expect(redisMock.set).toHaveBeenCalledTimes(3);
    });

    it('fails after exhausting all retries', async () => {
      redisMock.set.mockResolvedValue(null);

      const result = await service.acquire({
        key: 'test-lock',
        ttlMs: 5000,
        maxRetries: 2,
        retryDelayMs: 10
      });

      expect(result.acquired).toBe(false);
      expect(redisMock.set).toHaveBeenCalledTimes(3);
    });

    it('handles Redis errors gracefully', async () => {
      redisMock.set.mockRejectedValue(new Error('Connection refused'));
      const errorSpy = jest.spyOn(service['logger'] as Logger, 'error');

      const result = await service.acquire({
        key: 'test-lock',
        ttlMs: 5000
      });

      expect(result.acquired).toBe(false);
      expect(result.lockId).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to acquire lock test-lock'));
    });
  });

  describe('release', () => {
    it('releases lock when lockId matches', async () => {
      redisMock.eval.mockResolvedValue(1);

      const result = await service.release('test-lock', 'lock-123');

      expect(result).toBe(true);
      expect(redisMock.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("get"'),
        1,
        'test-lock',
        'lock-123'
      );
    });

    it('fails to release when lockId does not match', async () => {
      redisMock.eval.mockResolvedValue(0);
      const warnSpy = jest.spyOn(service['logger'] as Logger, 'warn');

      const result = await service.release('test-lock', 'wrong-id');

      expect(result).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ownership mismatch or already expired'));
    });

    it('returns false when lockId is null', async () => {
      const warnSpy = jest.spyOn(service['logger'] as Logger, 'warn');

      const result = await service.release('test-lock', null);

      expect(result).toBe(false);
      expect(redisMock.eval).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no lockId provided'));
    });

    it('handles Redis errors during release', async () => {
      redisMock.eval.mockRejectedValue(new Error('Connection error'));
      const errorSpy = jest.spyOn(service['logger'] as Logger, 'error');

      const result = await service.release('test-lock', 'lock-123');

      expect(result).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to release lock test-lock'));
    });
  });

  describe('getLockInfo', () => {
    it('returns lock info when lock exists', async () => {
      redisMock.get.mockResolvedValue('lock-123');
      redisMock.pttl.mockResolvedValue(4500);

      const result = await service.getLockInfo('test-lock');

      expect(result.exists).toBe(true);
      expect(result.lockId).toBe('lock-123');
      expect(result.ttlMs).toBe(4500);
    });

    it('returns empty info when lock does not exist', async () => {
      redisMock.get.mockResolvedValue(null);
      redisMock.pttl.mockResolvedValue(-2);

      const result = await service.getLockInfo('test-lock');

      expect(result.exists).toBe(false);
      expect(result.lockId).toBeNull();
      expect(result.ttlMs).toBeNull();
    });

    it('handles Redis errors when getting lock info', async () => {
      redisMock.get.mockRejectedValue(new Error('Connection error'));
      const errorSpy = jest.spyOn(service['logger'] as Logger, 'error');

      const result = await service.getLockInfo('test-lock');

      expect(result.exists).toBe(false);
      expect(result.lockId).toBeNull();
      expect(result.ttlMs).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to get lock info for test-lock'));
    });
  });

  describe('extend', () => {
    it('extends TTL when we own the lock', async () => {
      redisMock.eval.mockResolvedValue(1);

      const result = await service.extend('test-lock', 'lock-123', 10000);

      expect(result).toBe(true);
      expect(redisMock.eval).toHaveBeenCalledWith(
        expect.stringContaining('pexpire'),
        1,
        'test-lock',
        'lock-123',
        10000
      );
    });

    it('fails to extend when we do not own the lock', async () => {
      redisMock.eval.mockResolvedValue(0);

      const result = await service.extend('test-lock', 'wrong-id', 10000);

      expect(result).toBe(false);
    });

    it('handles Redis errors during extend', async () => {
      redisMock.eval.mockRejectedValue(new Error('Connection error'));
      const errorSpy = jest.spyOn(service['logger'] as Logger, 'error');

      const result = await service.extend('test-lock', 'lock-123', 10000);

      expect(result).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to extend lock test-lock'));
    });
  });

  describe('onModuleDestroy', () => {
    it('closes Redis connection gracefully', async () => {
      const logSpy = jest.spyOn(service['logger'] as Logger, 'log');

      await service.onModuleDestroy();

      expect(redisMock.quit).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith('Distributed lock Redis connection closed');
    });

    it('disconnects forcefully if quit fails', async () => {
      redisMock.quit.mockRejectedValue(new Error('Timeout'));
      const warnSpy = jest.spyOn(service['logger'] as Logger, 'warn');

      await service.onModuleDestroy();

      expect(redisMock.disconnect).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Error closing Redis connection'));
    });
  });
});
