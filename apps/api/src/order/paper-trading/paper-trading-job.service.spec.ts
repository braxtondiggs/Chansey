import { getQueueToken } from '@nestjs/bullmq';
import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { PaperTradingOrder, PaperTradingSession, PaperTradingStatus } from './entities';
import { PaperTradingEngineService } from './paper-trading-engine.service';
import { PaperTradingJobService } from './paper-trading-job.service';
import { PaperTradingJobType } from './paper-trading.job-data';

jest.mock('../../shared/queue.util', () => ({
  forceRemoveJob: jest.fn().mockResolvedValue(undefined)
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { forceRemoveJob } = require('../../shared/queue.util');

describe('PaperTradingJobService', () => {
  let service: PaperTradingJobService;
  let sessionRepository: any;
  let orderRepository: any;
  let paperTradingQueue: any;
  let eventEmitter: any;
  let engineService: any;

  beforeEach(async () => {
    sessionRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      update: jest.fn()
    };

    orderRepository = {
      createQueryBuilder: jest.fn()
    };

    paperTradingQueue = {
      add: jest.fn(),
      getJob: jest.fn().mockResolvedValue(null),
      removeJobScheduler: jest.fn(),
      upsertJobScheduler: jest.fn()
    };

    eventEmitter = { emit: jest.fn() };

    engineService = {
      clearThrottleState: jest.fn(),
      clearExitTracker: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaperTradingJobService,
        { provide: getRepositoryToken(PaperTradingSession), useValue: sessionRepository },
        { provide: getRepositoryToken(PaperTradingOrder), useValue: orderRepository },
        { provide: getQueueToken('paper-trading'), useValue: paperTradingQueue },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: PaperTradingEngineService, useValue: engineService }
      ]
    }).compile();

    service = module.get<PaperTradingJobService>(PaperTradingJobService);
    jest.clearAllMocks();
  });

  describe('scheduleTickJob', () => {
    it('creates scheduler with correct jobId and interval', async () => {
      paperTradingQueue.upsertJobScheduler.mockResolvedValue(undefined);

      await service.scheduleTickJob('sess-1', 'user-1', 30000);

      expect(paperTradingQueue.upsertJobScheduler).toHaveBeenCalledWith(
        'paper-trading-tick-sess-1',
        { every: 30000 },
        { name: 'tick', data: { type: PaperTradingJobType.TICK, sessionId: 'sess-1', userId: 'user-1' } }
      );
    });
  });

  describe('scheduleRetryTick', () => {
    it('removes existing retry job before scheduling new one', async () => {
      await service.scheduleRetryTick('sess-1', 'user-1', 5000, 2);

      expect(forceRemoveJob).toHaveBeenCalledWith(paperTradingQueue, 'paper-trading-retry-sess-1', expect.anything());
      expect(paperTradingQueue.add).toHaveBeenCalledWith(
        'retry-tick',
        {
          type: PaperTradingJobType.RETRY_TICK,
          sessionId: 'sess-1',
          userId: 'user-1',
          retryAttempt: 2,
          delayMs: 5000
        },
        { delay: 5000, jobId: 'paper-trading-retry-sess-1', removeOnComplete: true }
      );
    });
  });

  describe('removeTickJobs', () => {
    it('removes both tick scheduler and retry job', async () => {
      paperTradingQueue.removeJobScheduler.mockResolvedValue(undefined);

      await service.removeTickJobs('sess-1');

      expect(paperTradingQueue.removeJobScheduler).toHaveBeenCalledWith('paper-trading-tick-sess-1');
      expect(forceRemoveJob).toHaveBeenCalledWith(paperTradingQueue, 'paper-trading-retry-sess-1', expect.anything());
    });

    it('silently ignores "Job scheduler not found" errors', async () => {
      paperTradingQueue.removeJobScheduler.mockRejectedValue(new Error('Job scheduler not found'));

      await expect(service.removeTickJobs('sess-1')).resolves.toBeUndefined();
    });

    it('logs warning for unexpected errors during scheduler removal', async () => {
      paperTradingQueue.removeJobScheduler.mockRejectedValue(new Error('Redis connection lost'));

      await expect(service.removeTickJobs('sess-1')).resolves.toBeUndefined();
    });
  });

  describe('markFailed', () => {
    it('updates status, sets error details, and cleans up session', async () => {
      sessionRepository.update.mockResolvedValue(undefined);
      paperTradingQueue.removeJobScheduler.mockResolvedValue(undefined);

      await service.markFailed('sess-1', 'exchange timeout');

      expect(sessionRepository.update).toHaveBeenCalledWith('sess-1', {
        status: PaperTradingStatus.FAILED,
        errorMessage: 'exchange timeout',
        stoppedAt: expect.any(Date),
        stoppedReason: 'error'
      });
      expect(engineService.clearThrottleState).toHaveBeenCalledWith('sess-1');
      expect(engineService.clearExitTracker).toHaveBeenCalledWith('sess-1');
    });
  });

  describe('markCompleted', () => {
    const createActiveSession = (overrides: Partial<any> = {}): Record<string, any> => ({
      id: 'sess-1',
      status: PaperTradingStatus.ACTIVE,
      user: { id: 'user-1' },
      pipelineId: 'pipe-1',
      initialCapital: 10000,
      currentPortfolioValue: 12000,
      startedAt: new Date('2024-01-01'),
      createdAt: new Date('2024-01-01'),
      ...overrides
    });

    it('updates session, cleans up, and emits pipeline event with metrics', async () => {
      const session = createActiveSession();
      sessionRepository.findOne.mockResolvedValue(session);
      sessionRepository.save.mockResolvedValue(session);
      paperTradingQueue.removeJobScheduler.mockResolvedValue(undefined);

      orderRepository.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ totalFees: 50 })
      });

      await service.markCompleted('sess-1', 'duration_reached');

      expect(session.status).toBe(PaperTradingStatus.COMPLETED);
      expect(session.completedAt).toBeInstanceOf(Date);
      expect(engineService.clearThrottleState).toHaveBeenCalledWith('sess-1');
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'paper-trading.completed',
        expect.objectContaining({
          sessionId: 'sess-1',
          pipelineId: 'pipe-1',
          stoppedReason: 'duration_reached'
        })
      );
    });

    it('skips event emission when session has no pipelineId', async () => {
      const session = createActiveSession({ pipelineId: null });
      sessionRepository.findOne.mockResolvedValue(session);
      sessionRepository.save.mockResolvedValue(session);
      paperTradingQueue.removeJobScheduler.mockResolvedValue(undefined);

      await service.markCompleted('sess-1', 'duration_reached');

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('returns early without saving when session not found', async () => {
      sessionRepository.findOne.mockResolvedValue(null);

      await service.markCompleted('missing-sess', 'duration_reached');

      expect(sessionRepository.save).not.toHaveBeenCalled();
      expect(engineService.clearThrottleState).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('uses initialCapital as fallback when currentPortfolioValue is null', async () => {
      const session = createActiveSession({ currentPortfolioValue: null });
      sessionRepository.findOne.mockResolvedValue(session);
      sessionRepository.save.mockResolvedValue(session);
      paperTradingQueue.removeJobScheduler.mockResolvedValue(undefined);

      orderRepository.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ totalFees: 0 })
      });

      await service.markCompleted('sess-1', 'duration_reached');

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'paper-trading.completed',
        expect.objectContaining({
          metrics: expect.objectContaining({
            currentPortfolioValue: 10000,
            totalReturn: 0,
            totalReturnPercent: 0
          })
        })
      );
    });
  });

  describe('getSessionStatus', () => {
    it('returns status with calculated metrics', async () => {
      const session = {
        id: 'sess-1',
        status: PaperTradingStatus.ACTIVE,
        user: { id: 'user-1' },
        initialCapital: 10000,
        currentPortfolioValue: 11000,
        startedAt: new Date('2024-01-01'),
        createdAt: new Date('2024-01-01'),
        stoppedReason: null
      };
      sessionRepository.findOne.mockResolvedValue(session);

      orderRepository.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ totalFees: 25 })
      });

      const result = await service.getSessionStatus('sess-1');

      expect(result.status).toBe(PaperTradingStatus.ACTIVE);
      expect(result.metrics.totalReturn).toBe(1000);
      expect(result.metrics.totalReturnPercent).toBe(10);
      expect(result.metrics.totalFees).toBe(25);
    });

    it('throws NotFoundException when session does not exist', async () => {
      sessionRepository.findOne.mockResolvedValue(null);

      await expect(service.getSessionStatus('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
