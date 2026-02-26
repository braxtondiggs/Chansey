import { getQueueToken } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Queue } from 'bullmq';

import { BacktestOrchestrationService } from './backtest-orchestration.service';
import { BacktestOrchestrationTask } from './backtest-orchestration.task';
import { STAGGER_INTERVAL_MS } from './dto/backtest-orchestration.dto';

import { OptimizationRun, OptimizationStatus } from '../optimization/entities/optimization-run.entity';
import { BacktestResultService } from '../order/backtest/backtest-result.service';
import { backtestConfig } from '../order/backtest/backtest.config';
import { Backtest, BacktestStatus, BacktestType } from '../order/backtest/backtest.entity';
import { BacktestService } from '../order/backtest/backtest.service';
import { Pipeline } from '../pipeline/entities/pipeline.entity';

const BACKTEST_QUEUE_NAMES = backtestConfig();

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

  const mockHistoricalQueue = { getJob: jest.fn() };
  const mockReplayQueue = { getJob: jest.fn() };
  const mockOptimizationQueue = { getJob: jest.fn() };

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

  const mockOptimizationRunRepository = {
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue(undefined)
  };

  const mockPipelineRepository = {
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn().mockResolvedValue(undefined)
  };

  const mockEventEmitter = {
    emit: jest.fn()
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BacktestOrchestrationTask,
        { provide: getQueueToken('backtest-orchestration'), useValue: mockQueue },
        { provide: getQueueToken(BACKTEST_QUEUE_NAMES.historicalQueue), useValue: mockHistoricalQueue },
        { provide: getQueueToken(BACKTEST_QUEUE_NAMES.replayQueue), useValue: mockReplayQueue },
        { provide: getQueueToken('optimization'), useValue: mockOptimizationQueue },
        { provide: BacktestOrchestrationService, useValue: mockService },
        { provide: BacktestService, useValue: mockBacktestService },
        { provide: BacktestResultService, useValue: mockBacktestResultService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: getRepositoryToken(Backtest), useValue: mockBacktestRepository },
        { provide: getRepositoryToken(OptimizationRun), useValue: mockOptimizationRunRepository },
        { provide: getRepositoryToken(Pipeline), useValue: mockPipelineRepository }
      ]
    }).compile();

    task = module.get<BacktestOrchestrationTask>(BacktestOrchestrationTask);
    orchestrationQueue = module.get(getQueueToken('backtest-orchestration'));
    orchestrationService = module.get(BacktestOrchestrationService);

    // Pretend boot happened long ago so existing tests bypass the grace period
    (task as any).bootedAt = 0;

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
          removeOnFail: 50
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
          removeOnFail: 50
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
          removeOnFail: 50
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

  describe('detectStaleBacktests — boot grace period', () => {
    it('should skip stale detection during boot grace period', async () => {
      (task as any).bootedAt = Date.now(); // just booted

      await task.detectStaleBacktests();

      expect(mockBacktestRepository.find).not.toHaveBeenCalled();
      expect(mockBacktestResultService.markFailed).not.toHaveBeenCalled();
    });

    it('should run stale detection after boot grace period', async () => {
      (task as any).bootedAt = Date.now() - 11 * 60 * 1000; // 11 min ago
      mockBacktestRepository.find.mockResolvedValue([]);

      await task.detectStaleBacktests();

      expect(mockBacktestRepository.find).toHaveBeenCalledTimes(3);
    });
  });

  describe('detectStaleBacktests', () => {
    it('should do nothing when no stale backtests exist', async () => {
      mockBacktestRepository.find.mockResolvedValue([]);

      await task.detectStaleBacktests();

      // Three find calls: HISTORICAL, LIVE_REPLAY, PENDING
      expect(mockBacktestRepository.find).toHaveBeenCalledTimes(3);
      expect(mockBacktestResultService.markFailed).not.toHaveBeenCalled();
    });

    it('should mark stale HISTORICAL backtests as failed with 90-min threshold', async () => {
      const staleBacktest = {
        id: 'stale-bt-1',
        type: BacktestType.HISTORICAL,
        status: BacktestStatus.RUNNING,
        lastCheckpointAt: new Date(Date.now() - 100 * 60 * 1000),
        processedTimestampCount: 500,
        totalTimestampCount: 2000,
        checkpointState: { lastProcessedIndex: 499 }
      };
      // First call (HISTORICAL) returns stale, second (LIVE_REPLAY) and third (PENDING) return empty
      mockBacktestRepository.find
        .mockResolvedValueOnce([staleBacktest])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await task.detectStaleBacktests();

      expect(mockBacktestResultService.markFailed).toHaveBeenCalledWith(
        'stale-bt-1',
        expect.stringContaining('Stale: no heartbeat progress for 90 min')
      );
    });

    it('should mark stale LIVE_REPLAY backtests as failed with 120-min threshold', async () => {
      const staleReplay = {
        id: 'stale-replay-1',
        type: BacktestType.LIVE_REPLAY,
        status: BacktestStatus.RUNNING,
        lastCheckpointAt: new Date(Date.now() - 130 * 60 * 1000),
        processedTimestampCount: 200,
        totalTimestampCount: 1000,
        checkpointState: { lastProcessedIndex: 199 }
      };
      // First call (HISTORICAL) returns empty, second (LIVE_REPLAY) returns stale, third (PENDING) returns empty
      mockBacktestRepository.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([staleReplay])
        .mockResolvedValueOnce([]);

      await task.detectStaleBacktests();

      expect(mockBacktestResultService.markFailed).toHaveBeenCalledWith(
        'stale-replay-1',
        expect.stringContaining('Stale: no heartbeat progress for 120 min')
      );
    });

    it('should continue loop when markFailed throws for one backtest', async () => {
      const stale1 = {
        id: 'stale-1',
        type: BacktestType.HISTORICAL,
        status: BacktestStatus.RUNNING,
        lastCheckpointAt: new Date(Date.now() - 100 * 60 * 1000),
        processedTimestampCount: 100,
        totalTimestampCount: 500,
        checkpointState: { lastProcessedIndex: 99 }
      };
      const stale2 = {
        id: 'stale-2',
        type: BacktestType.HISTORICAL,
        status: BacktestStatus.RUNNING,
        lastCheckpointAt: new Date(Date.now() - 110 * 60 * 1000),
        processedTimestampCount: 200,
        totalTimestampCount: 600,
        checkpointState: { lastProcessedIndex: 199 }
      };
      mockBacktestRepository.find
        .mockResolvedValueOnce([stale1, stale2])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      // First markFailed throws, second should still be called
      mockBacktestResultService.markFailed
        .mockRejectedValueOnce(new Error('DB connection lost'))
        .mockResolvedValueOnce(undefined);

      await task.detectStaleBacktests();

      expect(mockBacktestResultService.markFailed).toHaveBeenCalledTimes(2);
      expect(mockBacktestResultService.markFailed).toHaveBeenCalledWith('stale-1', expect.any(String));
      expect(mockBacktestResultService.markFailed).toHaveBeenCalledWith('stale-2', expect.any(String));
    });

    it('should mark stuck PENDING backtests as failed with 30-min threshold', async () => {
      const stuckPending = {
        id: 'pending-bt-1',
        type: BacktestType.HISTORICAL,
        status: BacktestStatus.PENDING,
        updatedAt: new Date(Date.now() - 45 * 60 * 1000),
        processedTimestampCount: 0,
        totalTimestampCount: 0,
        checkpointState: null
      };
      // First (HISTORICAL) and second (LIVE_REPLAY) return empty, third (PENDING) returns stuck
      mockBacktestRepository.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([stuckPending]);
      // BullMQ job is missing — truly lost
      mockHistoricalQueue.getJob.mockResolvedValue(null);

      await task.detectStaleBacktests();

      expect(mockBacktestResultService.markFailed).toHaveBeenCalledWith(
        'pending-bt-1',
        expect.stringContaining('Stuck PENDING for 30 min')
      );
    });

    it('should skip PENDING backtest when BullMQ job is in waiting state', async () => {
      const stuckPending = {
        id: 'pending-bt-2',
        type: BacktestType.HISTORICAL,
        status: BacktestStatus.PENDING,
        updatedAt: new Date(Date.now() - 45 * 60 * 1000),
        processedTimestampCount: 0,
        totalTimestampCount: 0,
        checkpointState: null
      };
      mockBacktestRepository.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([stuckPending]);
      mockHistoricalQueue.getJob.mockResolvedValue({ getState: jest.fn().mockResolvedValue('waiting') });

      await task.detectStaleBacktests();

      expect(mockBacktestResultService.markFailed).not.toHaveBeenCalled();
    });

    it('should skip PENDING backtest when BullMQ job is in active state', async () => {
      const stuckPending = {
        id: 'pending-bt-active',
        type: BacktestType.HISTORICAL,
        status: BacktestStatus.PENDING,
        updatedAt: new Date(Date.now() - 45 * 60 * 1000),
        processedTimestampCount: 0,
        totalTimestampCount: 0,
        checkpointState: null
      };
      mockBacktestRepository.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([stuckPending]);
      mockHistoricalQueue.getJob.mockResolvedValue({ getState: jest.fn().mockResolvedValue('active') });

      await task.detectStaleBacktests();

      expect(mockBacktestResultService.markFailed).not.toHaveBeenCalled();
    });

    it('should skip PENDING LIVE_REPLAY backtest when BullMQ job is in delayed state', async () => {
      const stuckPending = {
        id: 'pending-replay-1',
        type: BacktestType.LIVE_REPLAY,
        status: BacktestStatus.PENDING,
        updatedAt: new Date(Date.now() - 45 * 60 * 1000),
        processedTimestampCount: 0,
        totalTimestampCount: 0,
        checkpointState: null
      };
      mockBacktestRepository.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([stuckPending]);
      mockReplayQueue.getJob.mockResolvedValue({ getState: jest.fn().mockResolvedValue('delayed') });

      await task.detectStaleBacktests();

      expect(mockBacktestResultService.markFailed).not.toHaveBeenCalled();
    });

    it('should still mark PENDING backtest as FAILED when BullMQ job is missing', async () => {
      const stuckPending = {
        id: 'pending-bt-3',
        type: BacktestType.HISTORICAL,
        status: BacktestStatus.PENDING,
        updatedAt: new Date(Date.now() - 45 * 60 * 1000),
        processedTimestampCount: 0,
        totalTimestampCount: 0,
        checkpointState: null
      };
      mockBacktestRepository.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([stuckPending]);
      mockHistoricalQueue.getJob.mockResolvedValue(null);

      await task.detectStaleBacktests();

      expect(mockBacktestResultService.markFailed).toHaveBeenCalledWith(
        'pending-bt-3',
        expect.stringContaining('Stuck PENDING for 30 min')
      );
    });

    it('should still mark PENDING backtest as FAILED when queue check errors', async () => {
      const stuckPending = {
        id: 'pending-bt-4',
        type: BacktestType.HISTORICAL,
        status: BacktestStatus.PENDING,
        updatedAt: new Date(Date.now() - 45 * 60 * 1000),
        processedTimestampCount: 0,
        totalTimestampCount: 0,
        checkpointState: null
      };
      mockBacktestRepository.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([stuckPending]);
      mockHistoricalQueue.getJob.mockRejectedValue(new Error('Redis connection lost'));

      await task.detectStaleBacktests();

      expect(mockBacktestResultService.markFailed).toHaveBeenCalledWith(
        'pending-bt-4',
        expect.stringContaining('Stuck PENDING for 30 min')
      );
    });
  });

  describe('detectStaleOptimizationRuns — queue-aware PENDING check', () => {
    it('should skip PENDING optimization run when BullMQ job is in waiting state', async () => {
      const pendingRun = {
        id: 'opt-run-1',
        status: OptimizationStatus.PENDING,
        createdAt: new Date(Date.now() - 400 * 60 * 1000),
        combinationsTested: 0,
        totalCombinations: 100
      };
      mockOptimizationRunRepository.find.mockResolvedValue([pendingRun]);
      mockOptimizationQueue.getJob.mockResolvedValue({ getState: jest.fn().mockResolvedValue('waiting') });

      await task.detectStaleOptimizationRuns();

      expect(mockOptimizationRunRepository.update).not.toHaveBeenCalled();
    });

    it('should still mark PENDING optimization run as FAILED when BullMQ job is missing', async () => {
      const pendingRun = {
        id: 'opt-run-2',
        status: OptimizationStatus.PENDING,
        createdAt: new Date(Date.now() - 400 * 60 * 1000),
        combinationsTested: 0,
        totalCombinations: 100
      };
      mockOptimizationRunRepository.find.mockResolvedValue([pendingRun]);
      mockOptimizationQueue.getJob.mockResolvedValue(null);
      mockOptimizationRunRepository.update.mockResolvedValue({ affected: 1 });

      await task.detectStaleOptimizationRuns();

      expect(mockOptimizationRunRepository.update).toHaveBeenCalledWith(
        { id: 'opt-run-2', status: expect.anything() },
        expect.objectContaining({
          status: OptimizationStatus.FAILED,
          errorMessage: expect.stringContaining('PENDING')
        })
      );
    });

    it('should still mark PENDING optimization run as FAILED when queue check errors', async () => {
      const pendingRun = {
        id: 'opt-run-3',
        status: OptimizationStatus.PENDING,
        createdAt: new Date(Date.now() - 400 * 60 * 1000),
        combinationsTested: 0,
        totalCombinations: 100
      };
      mockOptimizationRunRepository.find.mockResolvedValue([pendingRun]);
      mockOptimizationQueue.getJob.mockRejectedValue(new Error('Redis timeout'));
      mockOptimizationRunRepository.update.mockResolvedValue({ affected: 1 });

      await task.detectStaleOptimizationRuns();

      expect(mockOptimizationRunRepository.update).toHaveBeenCalledWith(
        { id: 'opt-run-3', status: expect.anything() },
        expect.objectContaining({
          status: OptimizationStatus.FAILED
        })
      );
    });
  });
});
