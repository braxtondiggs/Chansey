import { Logger } from '@nestjs/common';

import { PaperTradingRecoveryService } from './paper-trading-recovery.service';

describe('PaperTradingRecoveryService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('recovers active sessions on module init', async () => {
    const paperTradingService = {
      findActiveSessions: jest.fn().mockResolvedValue([
        { id: 'session-1', user: { id: 'user-1' }, tickIntervalMs: 1000 },
        { id: 'session-2', user: { id: 'user-2' }, tickIntervalMs: 2000 }
      ]),
      removeTickJobs: jest.fn(),
      scheduleTickJob: jest.fn(),
      markFailed: jest.fn()
    };

    const service = new PaperTradingRecoveryService(paperTradingService as any);

    await service.onApplicationBootstrap();

    expect(paperTradingService.findActiveSessions).toHaveBeenCalled();
    expect(paperTradingService.removeTickJobs).toHaveBeenCalledWith('session-1');
    expect(paperTradingService.removeTickJobs).toHaveBeenCalledWith('session-2');
    expect(paperTradingService.scheduleTickJob).toHaveBeenCalledWith('session-1', 'user-1', 1000);
    expect(paperTradingService.scheduleTickJob).toHaveBeenCalledWith('session-2', 'user-2', 2000);
  });

  it('marks session failed when recovery fails', async () => {
    const paperTradingService = {
      findActiveSessions: jest
        .fn()
        .mockResolvedValue([{ id: 'session-3', user: { id: 'user-3' }, tickIntervalMs: 5000 }]),
      removeTickJobs: jest.fn(),
      scheduleTickJob: jest.fn().mockRejectedValue(new Error('queue down')),
      markFailed: jest.fn()
    };

    const service = new PaperTradingRecoveryService(paperTradingService as any);

    await service.onApplicationBootstrap();

    expect(paperTradingService.markFailed).toHaveBeenCalledWith('session-3', expect.stringContaining('queue down'));
  });

  describe('detectStaleSessions', () => {
    const TEN_MINUTES = 10 * 60 * 1000;
    const TWENTY_MINUTES = 20 * 60 * 1000;

    function createService(paperTradingService: any, bootedAgo = TWENTY_MINUTES): PaperTradingRecoveryService {
      const service = new PaperTradingRecoveryService(paperTradingService as any);
      // Override bootedAt to simulate time since boot
      (service as any).bootedAt = Date.now() - bootedAgo;
      return service;
    }

    it('skips detection during boot grace period', async () => {
      const paperTradingService = {
        findActiveSessions: jest.fn()
      };

      // Boot 2 min ago — within 10 min grace period
      const service = createService(paperTradingService, 2 * 60 * 1000);

      await service.detectStaleSessions();

      expect(paperTradingService.findActiveSessions).not.toHaveBeenCalled();
    });

    it('no-op when no active sessions', async () => {
      const paperTradingService = {
        findActiveSessions: jest.fn().mockResolvedValue([]),
        removeTickJobs: jest.fn(),
        scheduleTickJob: jest.fn(),
        markFailed: jest.fn()
      };

      const service = createService(paperTradingService);

      await service.detectStaleSessions();

      expect(paperTradingService.findActiveSessions).toHaveBeenCalled();
      expect(paperTradingService.removeTickJobs).not.toHaveBeenCalled();
      expect(paperTradingService.markFailed).not.toHaveBeenCalled();
    });

    it('attempts recovery for sessions stale 10-20 min', async () => {
      const paperTradingService = {
        findActiveSessions: jest.fn().mockResolvedValue([
          {
            id: 'session-stale',
            user: { id: 'user-1' },
            tickIntervalMs: 5000,
            lastTickAt: new Date(Date.now() - 15 * 60 * 1000), // 15 min ago
            updatedAt: new Date(Date.now() - 30 * 60 * 1000)
          }
        ]),
        removeTickJobs: jest.fn(),
        scheduleTickJob: jest.fn(),
        markFailed: jest.fn()
      };

      const service = createService(paperTradingService);

      await service.detectStaleSessions();

      expect(paperTradingService.removeTickJobs).toHaveBeenCalledWith('session-stale');
      expect(paperTradingService.scheduleTickJob).toHaveBeenCalledWith('session-stale', 'user-1', 5000);
      expect(paperTradingService.markFailed).not.toHaveBeenCalled();
    });

    it('marks FAILED for sessions stale 20+ min', async () => {
      const paperTradingService = {
        findActiveSessions: jest.fn().mockResolvedValue([
          {
            id: 'session-dead',
            user: { id: 'user-1' },
            tickIntervalMs: 5000,
            lastTickAt: new Date(Date.now() - 25 * 60 * 1000), // 25 min ago
            updatedAt: new Date(Date.now() - 30 * 60 * 1000)
          }
        ]),
        removeTickJobs: jest.fn(),
        scheduleTickJob: jest.fn(),
        markFailed: jest.fn()
      };

      const service = createService(paperTradingService);

      await service.detectStaleSessions();

      expect(paperTradingService.markFailed).toHaveBeenCalledWith(
        'session-dead',
        expect.stringContaining('stale for 20+ minutes')
      );
      expect(paperTradingService.removeTickJobs).not.toHaveBeenCalled();
      expect(paperTradingService.scheduleTickJob).not.toHaveBeenCalled();
    });

    it('falls back to updatedAt when lastTickAt is null', async () => {
      const paperTradingService = {
        findActiveSessions: jest.fn().mockResolvedValue([
          {
            id: 'session-no-tick',
            user: { id: 'user-1' },
            tickIntervalMs: 5000,
            lastTickAt: null,
            updatedAt: new Date(Date.now() - 12 * 60 * 1000) // 12 min ago — recovery tier
          }
        ]),
        removeTickJobs: jest.fn(),
        scheduleTickJob: jest.fn(),
        markFailed: jest.fn()
      };

      const service = createService(paperTradingService);

      await service.detectStaleSessions();

      expect(paperTradingService.removeTickJobs).toHaveBeenCalledWith('session-no-tick');
      expect(paperTradingService.scheduleTickJob).toHaveBeenCalledWith('session-no-tick', 'user-1', 5000);
      expect(paperTradingService.markFailed).not.toHaveBeenCalled();
    });

    it('skips healthy sessions with recent heartbeat', async () => {
      const paperTradingService = {
        findActiveSessions: jest.fn().mockResolvedValue([
          {
            id: 'session-healthy',
            user: { id: 'user-1' },
            tickIntervalMs: 5000,
            lastTickAt: new Date(Date.now() - 2 * 60 * 1000), // 2 min ago — healthy
            updatedAt: new Date(Date.now() - 30 * 60 * 1000)
          }
        ]),
        removeTickJobs: jest.fn(),
        scheduleTickJob: jest.fn(),
        markFailed: jest.fn()
      };

      const service = createService(paperTradingService);

      await service.detectStaleSessions();

      expect(paperTradingService.removeTickJobs).not.toHaveBeenCalled();
      expect(paperTradingService.scheduleTickJob).not.toHaveBeenCalled();
      expect(paperTradingService.markFailed).not.toHaveBeenCalled();
    });

    it('error on one session does not abort processing others', async () => {
      const paperTradingService = {
        findActiveSessions: jest.fn().mockResolvedValue([
          {
            id: 'session-error',
            user: { id: 'user-1' },
            tickIntervalMs: 5000,
            lastTickAt: new Date(Date.now() - 15 * 60 * 1000),
            updatedAt: new Date(Date.now() - 30 * 60 * 1000)
          },
          {
            id: 'session-ok',
            user: { id: 'user-2' },
            tickIntervalMs: 3000,
            lastTickAt: new Date(Date.now() - 12 * 60 * 1000),
            updatedAt: new Date(Date.now() - 30 * 60 * 1000)
          }
        ]),
        removeTickJobs: jest.fn().mockImplementation((id: string) => {
          if (id === 'session-error') throw new Error('Redis down');
        }),
        scheduleTickJob: jest.fn(),
        markFailed: jest.fn()
      };

      const service = createService(paperTradingService);

      await service.detectStaleSessions();

      // First session throws, but second session should still be processed
      expect(paperTradingService.removeTickJobs).toHaveBeenCalledWith('session-error');
      expect(paperTradingService.removeTickJobs).toHaveBeenCalledWith('session-ok');
      expect(paperTradingService.scheduleTickJob).toHaveBeenCalledWith('session-ok', 'user-2', 3000);
    });
  });
});
