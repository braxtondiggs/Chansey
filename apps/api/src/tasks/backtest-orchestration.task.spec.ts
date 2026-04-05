import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';

import { Queue } from 'bullmq';

import { BacktestOrchestrationService } from './backtest-orchestration.service';
import { BacktestOrchestrationTask } from './backtest-orchestration.task';
import { BacktestWatchdogService } from './backtest-watchdog.service';
import { BACKTEST_STAGGER_INTERVAL_MS } from './dto/backtest-orchestration.dto';

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

  const mockWatchdog = {
    detectStaleBacktests: jest.fn().mockResolvedValue(undefined),
    detectStaleOptimizationRuns: jest.fn().mockResolvedValue(undefined),
    detectOrphanedOptimizePipelines: jest.fn().mockResolvedValue(undefined),
    detectFailedOptimizationPipelines: jest.fn().mockResolvedValue(undefined)
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BacktestOrchestrationTask,
        { provide: getQueueToken('backtest-orchestration'), useValue: mockQueue },
        { provide: BacktestOrchestrationService, useValue: mockService },
        { provide: BacktestService, useValue: mockBacktestService },
        { provide: BacktestWatchdogService, useValue: mockWatchdog }
      ]
    }).compile();

    task = module.get<BacktestOrchestrationTask>(BacktestOrchestrationTask);
    orchestrationQueue = module.get(getQueueToken('backtest-orchestration'));
    orchestrationService = module.get(BacktestOrchestrationService);

    jest.clearAllMocks();
  });

  describe('scheduleOrchestration', () => {
    it('should ensure default dataset exists before querying users', async () => {
      orchestrationService.getEligibleUsers.mockResolvedValue([]);

      await task.scheduleOrchestration();

      expect(mockBacktestService.ensureDefaultDatasetExists).toHaveBeenCalledTimes(1);
      expect(orchestrationService.getEligibleUsers).toHaveBeenCalledTimes(1);
    });

    it('should skip scheduling when no eligible users', async () => {
      orchestrationService.getEligibleUsers.mockResolvedValue([]);

      await task.scheduleOrchestration();

      expect(orchestrationQueue.add).not.toHaveBeenCalled();
    });

    it('should queue staggered orchestration jobs for eligible users', async () => {
      orchestrationService.getEligibleUsers.mockResolvedValue([
        { id: 'user-1', coinRisk: { level: 4 }, effectiveCalculationRiskLevel: 4 },
        { id: 'user-2', coinRisk: null, effectiveCalculationRiskLevel: 3 }
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
          delay: BACKTEST_STAGGER_INTERVAL_MS,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 },
          removeOnComplete: true,
          removeOnFail: 50
        })
      );
    });

    it('should catch errors without propagating', async () => {
      orchestrationService.getEligibleUsers.mockRejectedValue(new Error('DB connection lost'));

      await expect(task.scheduleOrchestration()).resolves.toBeUndefined();
      expect(orchestrationQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('triggerManualOrchestration', () => {
    it('should queue a single user orchestration job', async () => {
      const result = await task.triggerManualOrchestration('user-99');

      expect(orchestrationQueue.add).toHaveBeenCalledWith(
        'orchestrate-user',
        expect.objectContaining({
          userId: 'user-99',
          scheduledAt: expect.any(String)
        }),
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 },
          removeOnComplete: true,
          removeOnFail: 50
        })
      );
      // Manual trigger should not include riskLevel
      const jobData = orchestrationQueue.add.mock.calls[0][1];
      expect(jobData).not.toHaveProperty('riskLevel');
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

  describe('runWatchdogChecks', () => {
    it('should delegate all watchdog checks in a single call', async () => {
      await task.runWatchdogChecks();

      expect(mockWatchdog.detectStaleBacktests).toHaveBeenCalledTimes(1);
      expect(mockWatchdog.detectStaleOptimizationRuns).toHaveBeenCalledTimes(1);
      expect(mockWatchdog.detectOrphanedOptimizePipelines).toHaveBeenCalledTimes(1);
      expect(mockWatchdog.detectFailedOptimizationPipelines).toHaveBeenCalledTimes(1);
    });

    it('should not run concurrently (re-entrant guard)', async () => {
      // Simulate a long-running watchdog check
      mockWatchdog.detectStaleBacktests.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));

      // Start first run (don't await yet)
      const firstRun = task.runWatchdogChecks();
      // Start second run immediately (should be skipped)
      const secondRun = task.runWatchdogChecks();

      await Promise.all([firstRun, secondRun]);

      // detectStaleBacktests should only be called once (second run skipped)
      expect(mockWatchdog.detectStaleBacktests).toHaveBeenCalledTimes(1);
    });
  });
});
