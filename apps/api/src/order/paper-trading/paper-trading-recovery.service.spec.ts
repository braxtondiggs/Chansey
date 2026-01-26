import { Logger } from '@nestjs/common';

import { PaperTradingRecoveryService } from './paper-trading-recovery.service';

describe('PaperTradingRecoveryService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
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
      scheduleTickJob: jest.fn(),
      markFailed: jest.fn()
    };

    const service = new PaperTradingRecoveryService(paperTradingService as any);

    await service.onApplicationBootstrap();

    expect(paperTradingService.findActiveSessions).toHaveBeenCalled();
    expect(paperTradingService.scheduleTickJob).toHaveBeenCalledWith('session-1', 'user-1', 1000);
    expect(paperTradingService.scheduleTickJob).toHaveBeenCalledWith('session-2', 'user-2', 2000);
  });

  it('marks session failed when recovery fails', async () => {
    const paperTradingService = {
      findActiveSessions: jest
        .fn()
        .mockResolvedValue([{ id: 'session-3', user: { id: 'user-3' }, tickIntervalMs: 5000 }]),
      scheduleTickJob: jest.fn().mockRejectedValue(new Error('queue down')),
      markFailed: jest.fn()
    };

    const service = new PaperTradingRecoveryService(paperTradingService as any);

    await service.onApplicationBootstrap();

    expect(paperTradingService.markFailed).toHaveBeenCalledWith('session-3', expect.stringContaining('queue down'));
  });
});
