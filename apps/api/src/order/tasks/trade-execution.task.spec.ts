import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { TradeExecutionTask } from './trade-execution.task';

import { TradingStateService } from '../../admin/trading-state/trading-state.service';
import { FailedJobService } from '../../failed-jobs/failed-job.service';
import { TradeOrchestratorService } from '../services/trade-orchestrator.service';

describe('TradeExecutionTask', () => {
  let task: TradeExecutionTask;
  let mockQueue: any;
  let mockTradeOrchestrator: any;
  let mockTradingStateService: any;
  let mockFailedJobService: any;

  const orchestratorResult = {
    totalActivations: 5,
    successCount: 3,
    failCount: 0,
    skippedCount: 1,
    blockedCount: 1,
    timestamp: '2026-01-01T00:00:00.000Z'
  };

  const mockJob = {
    id: 'job-1',
    name: 'execute-trades',
    data: { timestamp: '2026-01-01T00:00:00.000Z' },
    updateProgress: jest.fn(),
    opts: { attempts: 3 },
    attemptsMade: 1
  } as any;

  beforeEach(async () => {
    mockQueue = {
      add: jest.fn(),
      getRepeatableJobs: jest.fn().mockResolvedValue([])
    };

    mockTradingStateService = {
      isTradingEnabled: jest.fn().mockReturnValue(true)
    };

    mockTradeOrchestrator = {
      executeTrades: jest.fn().mockResolvedValue(orchestratorResult)
    };

    mockFailedJobService = {
      recordFailure: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeExecutionTask,
        { provide: getQueueToken('trade-execution'), useValue: mockQueue },
        { provide: TradeOrchestratorService, useValue: mockTradeOrchestrator },
        { provide: TradingStateService, useValue: mockTradingStateService },
        { provide: FailedJobService, useValue: mockFailedJobService }
      ]
    }).compile();

    task = module.get<TradeExecutionTask>(TradeExecutionTask);

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.DISABLE_TRADE_EXECUTION;
  });

  describe('process()', () => {
    it('should delegate to TradeOrchestratorService and return its result', async () => {
      const result: any = await task.process(mockJob);

      expect(mockTradeOrchestrator.executeTrades).toHaveBeenCalledTimes(1);
      expect(result).toEqual(orchestratorResult);
    });

    it('should wire progress callback to job.updateProgress', async () => {
      mockTradeOrchestrator.executeTrades.mockImplementation(async (cb: (pct: number) => Promise<void>) => {
        await cb(50);
        return orchestratorResult;
      });

      await task.process(mockJob);

      expect(mockJob.updateProgress).toHaveBeenCalledWith(50);
    });

    it('should return failure for unknown job type', async () => {
      const result: any = await task.process({ ...mockJob, name: 'unknown-job' } as any);
      expect(result).toEqual({ success: false, message: 'Unknown job type: unknown-job' });
    });

    it('should skip execution when trading is globally halted', async () => {
      mockTradingStateService.isTradingEnabled.mockReturnValue(false);

      const result: any = await task.process(mockJob);

      expect(result).toEqual({ success: false, message: 'Trading globally halted' });
      expect(mockTradeOrchestrator.executeTrades).not.toHaveBeenCalled();
    });

    it('should re-throw errors from orchestrator for BullMQ retry', async () => {
      mockTradeOrchestrator.executeTrades.mockRejectedValue(new Error('Orchestration failed'));

      await expect(task.process(mockJob)).rejects.toThrow('Orchestration failed');
    });
  });

  describe('onModuleInit()', () => {
    it('should schedule repeatable job when none exists', async () => {
      await task.onModuleInit();

      expect(mockQueue.add).toHaveBeenCalledWith(
        'execute-trades',
        expect.objectContaining({ description: 'Scheduled trade execution job' }),
        expect.objectContaining({
          repeat: { pattern: '0 */5 * * * *' },
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 50
        })
      );
    });

    it('should not schedule if job already exists', async () => {
      mockQueue.getRepeatableJobs.mockResolvedValue([{ name: 'execute-trades', pattern: '*/5 * * * *' }]);

      await task.onModuleInit();

      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should not schedule when DISABLE_TRADE_EXECUTION is set', async () => {
      process.env.DISABLE_TRADE_EXECUTION = 'true';

      await task.onModuleInit();

      expect(mockQueue.getRepeatableJobs).not.toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should not double-schedule on repeated calls', async () => {
      await task.onModuleInit();
      await task.onModuleInit();

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
    });
  });

  describe('onFailed()', () => {
    it('should record failure with complete payload', async () => {
      const error = new Error('Test failure');
      error.stack = 'Error: Test failure\n    at test.ts:1:1';
      await task.onFailed(mockJob, error);

      expect(mockFailedJobService.recordFailure).toHaveBeenCalledWith({
        queueName: 'trade-execution',
        jobId: 'job-1',
        jobName: 'execute-trades',
        jobData: mockJob.data,
        errorMessage: 'Test failure',
        stackTrace: error.stack,
        attemptsMade: 1,
        maxAttempts: 3
      });
    });

    it('should silently swallow recordFailure errors', async () => {
      mockFailedJobService.recordFailure.mockRejectedValue(new Error('DB error'));

      await expect(task.onFailed(mockJob, new Error('Test'))).resolves.not.toThrow();
    });
  });
});
