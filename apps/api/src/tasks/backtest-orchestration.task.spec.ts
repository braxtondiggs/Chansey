import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';

import { Queue } from 'bullmq';

import { BacktestOrchestrationService } from './backtest-orchestration.service';
import { BacktestOrchestrationTask } from './backtest-orchestration.task';
import { STAGGER_INTERVAL_MS } from './dto/backtest-orchestration.dto';

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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BacktestOrchestrationTask,
        { provide: getQueueToken('backtest-orchestration'), useValue: mockQueue },
        { provide: BacktestOrchestrationService, useValue: mockService },
        { provide: BacktestService, useValue: mockBacktestService }
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
});
