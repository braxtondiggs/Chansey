import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Queue } from 'bullmq';

import { BacktestOrchestrationService } from './backtest-orchestration.service';
import { BacktestOrchestrationTask } from './backtest-orchestration.task';
import { STAGGER_INTERVAL_MS } from './dto/backtest-orchestration.dto';

import { BacktestResultService } from '../order/backtest/backtest-result.service';
import { Backtest, BacktestStatus, BacktestType } from '../order/backtest/backtest.entity';
import { BacktestService } from '../order/backtest/backtest.service';

describe('BacktestOrchestrationTask', () => {
  let task: BacktestOrchestrationTask;
  let orchestrationQueue: jest.Mocked<Queue>;
  let orchestrationService: jest.Mocked<BacktestOrchestrationService>;

  const mockQueue = {
    add: jest.fn(),
    getWaitingCount: jest.fn(),
    getActiveCount: jest.fn(),
    getCompletedCount: jest.fn(),
    getFailedCount: jest.fn(),
    getDelayedCount: jest.fn()
  };

  const mockService = {
    getEligibleUsers: jest.fn()
  };

  const mockBacktestService = {
    ensureDefaultDatasetExists: jest.fn().mockResolvedValue(null)
  };

  const mockBacktestResultService = {
    markFailed: jest.fn().mockResolvedValue(undefined)
  };

  const mockBacktestRepository = {
    find: jest.fn().mockResolvedValue([])
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BacktestOrchestrationTask,
        { provide: getQueueToken('backtest-orchestration'), useValue: mockQueue },
        { provide: BacktestOrchestrationService, useValue: mockService },
        { provide: BacktestService, useValue: mockBacktestService },
        { provide: BacktestResultService, useValue: mockBacktestResultService },
        { provide: getRepositoryToken(Backtest), useValue: mockBacktestRepository }
      ]
    }).compile();

    task = module.get<BacktestOrchestrationTask>(BacktestOrchestrationTask);
    orchestrationQueue = module.get(getQueueToken('backtest-orchestration'));
    orchestrationService = module.get(BacktestOrchestrationService);

    jest.clearAllMocks();
  });

  describe('scheduleOrchestration', () => {
    it('should skip scheduling when no eligible users', async () => {
      orchestrationService.getEligibleUsers.mockResolvedValue([]);

      await task.scheduleOrchestration();

      expect(orchestrationQueue.add).not.toHaveBeenCalled();
    });

    it('should queue staggered orchestration jobs for eligible users', async () => {
      orchestrationService.getEligibleUsers.mockResolvedValue([
        { id: 'user-1', risk: { level: 4 } },
        { id: 'user-2', risk: null }
      ] as any);

      await task.scheduleOrchestration();

      expect(orchestrationQueue.add).toHaveBeenNthCalledWith(
        1,
        'orchestrate-user',
        expect.objectContaining({
          userId: 'user-1',
          scheduledAt: expect.any(String),
          riskLevel: 4
        }),
        expect.objectContaining({
          delay: 0,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 },
          removeOnComplete: true,
          removeOnFail: false
        })
      );

      expect(orchestrationQueue.add).toHaveBeenNthCalledWith(
        2,
        'orchestrate-user',
        expect.objectContaining({
          userId: 'user-2',
          scheduledAt: expect.any(String),
          riskLevel: 3
        }),
        expect.objectContaining({
          delay: STAGGER_INTERVAL_MS,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 },
          removeOnComplete: true,
          removeOnFail: false
        })
      );
    });
  });

  describe('triggerManualOrchestration', () => {
    it('should queue a single user orchestration job', async () => {
      const result = await task.triggerManualOrchestration('user-99');

      expect(orchestrationQueue.add).toHaveBeenCalledWith(
        'orchestrate-user',
        expect.objectContaining({
          userId: 'user-99',
          scheduledAt: expect.any(String),
          riskLevel: 3
        }),
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 },
          removeOnComplete: true,
          removeOnFail: false
        })
      );
      expect(result).toEqual({ queued: 1 });
    });

    it('should trigger full orchestration when no userId is provided', async () => {
      const scheduleSpy = jest.spyOn(task, 'scheduleOrchestration').mockResolvedValue();
      orchestrationService.getEligibleUsers.mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }] as any);

      const result = await task.triggerManualOrchestration();

      expect(scheduleSpy).toHaveBeenCalled();
      expect(result).toEqual({ queued: 2 });
    });
  });

  describe('getQueueStats', () => {
    it('should return queue counts', async () => {
      orchestrationQueue.getWaitingCount.mockResolvedValue(2);
      orchestrationQueue.getActiveCount.mockResolvedValue(1);
      orchestrationQueue.getCompletedCount.mockResolvedValue(5);
      orchestrationQueue.getFailedCount.mockResolvedValue(0);
      orchestrationQueue.getDelayedCount.mockResolvedValue(3);

      const stats = await task.getQueueStats();

      expect(stats).toEqual({
        waiting: 2,
        active: 1,
        completed: 5,
        failed: 0,
        delayed: 3
      });
    });
  });

  describe('detectStaleBacktests', () => {
    it('should do nothing when no stale backtests exist', async () => {
      mockBacktestRepository.find.mockResolvedValue([]);

      await task.detectStaleBacktests();

      // Two find calls: one for HISTORICAL, one for LIVE_REPLAY
      expect(mockBacktestRepository.find).toHaveBeenCalledTimes(2);
      expect(mockBacktestResultService.markFailed).not.toHaveBeenCalled();
    });

    it('should mark stale HISTORICAL backtests as failed with 30-min threshold', async () => {
      const staleBacktest = {
        id: 'stale-bt-1',
        type: BacktestType.HISTORICAL,
        status: BacktestStatus.RUNNING,
        lastCheckpointAt: new Date(Date.now() - 45 * 60 * 1000),
        processedTimestampCount: 500,
        totalTimestampCount: 2000,
        checkpointState: { lastProcessedIndex: 499 }
      };
      // First call (HISTORICAL) returns stale, second call (LIVE_REPLAY) returns empty
      mockBacktestRepository.find.mockResolvedValueOnce([staleBacktest]).mockResolvedValueOnce([]);

      await task.detectStaleBacktests();

      expect(mockBacktestResultService.markFailed).toHaveBeenCalledWith(
        'stale-bt-1',
        expect.stringContaining('Stale: no checkpoint progress for 30 min')
      );
    });

    it('should mark stale LIVE_REPLAY backtests as failed with 60-min threshold', async () => {
      const staleReplay = {
        id: 'stale-replay-1',
        type: BacktestType.LIVE_REPLAY,
        status: BacktestStatus.RUNNING,
        lastCheckpointAt: new Date(Date.now() - 75 * 60 * 1000),
        processedTimestampCount: 200,
        totalTimestampCount: 1000,
        checkpointState: { lastProcessedIndex: 199 }
      };
      // First call (HISTORICAL) returns empty, second call (LIVE_REPLAY) returns stale
      mockBacktestRepository.find.mockResolvedValueOnce([]).mockResolvedValueOnce([staleReplay]);

      await task.detectStaleBacktests();

      expect(mockBacktestResultService.markFailed).toHaveBeenCalledWith(
        'stale-replay-1',
        expect.stringContaining('Stale: no checkpoint progress for 60 min')
      );
    });

    it('should NOT mark LIVE_REPLAY as stale within 60 min', async () => {
      const recentReplay = {
        id: 'recent-replay-1',
        type: BacktestType.LIVE_REPLAY,
        status: BacktestStatus.RUNNING,
        lastCheckpointAt: new Date(Date.now() - 40 * 60 * 1000),
        processedTimestampCount: 200,
        totalTimestampCount: 1000
      };
      // The 40-min-old replay should NOT appear in query results (threshold is 60 min)
      mockBacktestRepository.find.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      await task.detectStaleBacktests();

      expect(mockBacktestResultService.markFailed).not.toHaveBeenCalled();
    });

    it('should continue loop when markFailed throws for one backtest', async () => {
      const stale1 = {
        id: 'stale-1',
        type: BacktestType.HISTORICAL,
        status: BacktestStatus.RUNNING,
        lastCheckpointAt: new Date(Date.now() - 45 * 60 * 1000),
        processedTimestampCount: 100,
        totalTimestampCount: 500,
        checkpointState: { lastProcessedIndex: 99 }
      };
      const stale2 = {
        id: 'stale-2',
        type: BacktestType.HISTORICAL,
        status: BacktestStatus.RUNNING,
        lastCheckpointAt: new Date(Date.now() - 50 * 60 * 1000),
        processedTimestampCount: 200,
        totalTimestampCount: 600,
        checkpointState: { lastProcessedIndex: 199 }
      };
      mockBacktestRepository.find.mockResolvedValueOnce([stale1, stale2]).mockResolvedValueOnce([]);

      // First markFailed throws, second should still be called
      mockBacktestResultService.markFailed
        .mockRejectedValueOnce(new Error('DB connection lost'))
        .mockResolvedValueOnce(undefined);

      await task.detectStaleBacktests();

      expect(mockBacktestResultService.markFailed).toHaveBeenCalledTimes(2);
      expect(mockBacktestResultService.markFailed).toHaveBeenCalledWith('stale-1', expect.any(String));
      expect(mockBacktestResultService.markFailed).toHaveBeenCalledWith('stale-2', expect.any(String));
    });
  });
});
