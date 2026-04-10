import { BadRequestException, InternalServerErrorException } from '@nestjs/common';

import { DEFAULT_CHECKPOINT_CONFIG } from './backtest-checkpoint.interface';
import { BacktestLifecycleService } from './backtest-lifecycle.service';
import { type Backtest, BacktestStatus, BacktestType } from './backtest.entity';

import { NotFoundException } from '../../common/exceptions';

describe('BacktestLifecycleService', () => {
  const createService = () => {
    const backtestStream = {
      publishStatus: jest.fn().mockResolvedValue(undefined),
      publishLog: jest.fn().mockResolvedValue(undefined)
    };
    const job = { remove: jest.fn().mockResolvedValue(undefined) };
    const queue = {
      add: jest.fn().mockResolvedValue(undefined),
      getJob: jest.fn().mockResolvedValue(null)
    };
    const backtestResultService = { markCancelled: jest.fn().mockResolvedValue(undefined) };
    const backtestPauseService = {
      clearPauseFlag: jest.fn(),
      setPauseFlag: jest.fn().mockResolvedValue(undefined),
      isPauseRequested: jest.fn()
    };
    const metricsService = { recordBacktestCancelled: jest.fn() };

    const fetchMock = jest.fn();
    const coreRepository: any = {
      save: jest.fn().mockResolvedValue(undefined),
      fetchBacktestEntity: fetchMock,
      fetchWithStandardRelations: fetchMock,
      buildJobPayload: jest.fn().mockReturnValue({ payload: true }),
      getQueueForType: jest.fn().mockReturnValue(queue)
    };

    const service = new BacktestLifecycleService(
      coreRepository,
      backtestResultService as any,
      backtestPauseService as any,
      backtestStream as any,
      metricsService as any
    );

    return {
      service,
      backtestStream,
      coreRepository,
      queue,
      job,
      backtestResultService,
      backtestPauseService,
      metricsService
    };
  };

  const createBacktest = (overrides: Partial<Backtest> = {}): Backtest =>
    ({
      id: 'backtest-1',
      status: BacktestStatus.PAUSED,
      type: BacktestType.HISTORICAL,
      deterministicSeed: 'seed-1',
      processedTimestampCount: 10,
      totalTimestampCount: 100,
      totalTrades: 7,
      checkpointState: {
        lastProcessedIndex: 9,
        lastProcessedTimestamp: '2024-01-01T00:00:00.000Z',
        rngState: 123,
        portfolio: { cashBalance: 1000, positions: [] },
        peakValue: 1100,
        maxDrawdown: 0,
        persistedCounts: { trades: 4, signals: 1, fills: 1, snapshots: 1 },
        checksum: 'checksum'
      },
      lastCheckpointAt: new Date(),
      user: { id: 'user-1' },
      algorithm: { id: 'algo-1', name: 'rsi' },
      marketDataSet: { id: 'dataset-1' },
      ...overrides
    }) as Backtest;

  const user = { id: 'user-1' } as any;

  describe('resumeBacktest', () => {
    it('resumes with a valid checkpoint and publishes resume status', async () => {
      const { service, backtestStream, coreRepository, queue } = createService();
      const backtest = createBacktest();
      coreRepository.fetchBacktestEntity.mockResolvedValue(backtest);

      await service.resumeBacktest(user, backtest.id);

      expect(backtest.status).toBe(BacktestStatus.PENDING);
      expect(coreRepository.save).toHaveBeenCalledWith(backtest);
      expect(queue.add).toHaveBeenCalledWith(
        'execute-backtest',
        { payload: true },
        { jobId: backtest.id, removeOnComplete: true, removeOnFail: 50 }
      );
      expect(backtestStream.publishStatus).toHaveBeenCalledWith(backtest.id, 'queued', undefined, {
        resumed: true,
        hasCheckpoint: true,
        checkpointIndex: 9
      });
    });

    it('clears stale checkpoints older than the max age', async () => {
      const { service, backtestStream, coreRepository } = createService();
      const backtest = createBacktest({
        lastCheckpointAt: new Date(Date.now() - DEFAULT_CHECKPOINT_CONFIG.maxCheckpointAge - 1000)
      });
      coreRepository.fetchBacktestEntity.mockResolvedValue(backtest);

      await service.resumeBacktest(user, backtest.id);

      expect(backtest.checkpointState).toBeUndefined();
      expect(backtest.lastCheckpointAt).toBeUndefined();
      expect(backtest.processedTimestampCount).toBe(0);
      expect(backtestStream.publishStatus).toHaveBeenCalledWith(backtest.id, 'queued', undefined, {
        resumed: true,
        hasCheckpoint: false,
        checkpointIndex: undefined
      });
    });

    it.each([BacktestStatus.CANCELLED, BacktestStatus.FAILED])('resumes from %s status', async (status) => {
      const { service, coreRepository } = createService();
      const backtest = createBacktest({ status });
      coreRepository.fetchBacktestEntity.mockResolvedValue(backtest);

      await service.resumeBacktest(user, backtest.id);

      expect(backtest.status).toBe(BacktestStatus.PENDING);
    });

    it.each([BacktestStatus.RUNNING, BacktestStatus.COMPLETED, BacktestStatus.PENDING])(
      'rejects resume from %s',
      async (status) => {
        const { service, coreRepository } = createService();
        coreRepository.fetchBacktestEntity.mockResolvedValue(createBacktest({ status }));

        await expect(service.resumeBacktest(user, 'backtest-1')).rejects.toBeInstanceOf(BadRequestException);
      }
    );

    it('swallows publishStatus errors and still returns the backtest', async () => {
      const { service, backtestStream, coreRepository } = createService();
      const backtest = createBacktest();
      coreRepository.fetchBacktestEntity.mockResolvedValue(backtest);
      backtestStream.publishStatus.mockRejectedValueOnce(new Error('redis down'));

      await expect(service.resumeBacktest(user, backtest.id)).resolves.toBe(backtest);
    });

    it('wraps unexpected errors as InternalServerErrorException', async () => {
      const { service, coreRepository } = createService();
      coreRepository.fetchBacktestEntity.mockRejectedValue(new Error('db boom'));

      await expect(service.resumeBacktest(user, 'backtest-1')).rejects.toBeInstanceOf(InternalServerErrorException);
    });

    it('rethrows NotFoundException without wrapping', async () => {
      const { service, coreRepository } = createService();
      coreRepository.fetchBacktestEntity.mockRejectedValue(new NotFoundException('missing'));

      await expect(service.resumeBacktest(user, 'backtest-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('cancelBacktest', () => {
    it('removes job, marks cancelled, and records metric', async () => {
      const { service, coreRepository, queue, job, backtestResultService, metricsService, backtestStream } =
        createService();
      const backtest = createBacktest({ status: BacktestStatus.RUNNING });
      coreRepository.fetchBacktestEntity.mockResolvedValue(backtest);
      queue.getJob.mockResolvedValue(job);

      await service.cancelBacktest(user, backtest.id);

      expect(job.remove).toHaveBeenCalled();
      expect(backtestResultService.markCancelled).toHaveBeenCalledWith(backtest, 'User requested cancellation');
      expect(metricsService.recordBacktestCancelled).toHaveBeenCalledWith('rsi');
      expect(backtestStream.publishStatus).toHaveBeenCalledWith(
        backtest.id,
        'cancelled',
        undefined,
        expect.objectContaining({ reason: 'User requested cancellation' })
      );
    });

    it('handles missing job gracefully', async () => {
      const { service, coreRepository, backtestResultService } = createService();
      coreRepository.fetchBacktestEntity.mockResolvedValue(createBacktest({ status: BacktestStatus.PENDING }));

      await service.cancelBacktest(user, 'backtest-1');

      expect(backtestResultService.markCancelled).toHaveBeenCalled();
    });

    it.each([BacktestStatus.PAUSED, BacktestStatus.COMPLETED, BacktestStatus.FAILED, BacktestStatus.CANCELLED])(
      'rejects cancel from %s',
      async (status) => {
        const { service, coreRepository } = createService();
        coreRepository.fetchBacktestEntity.mockResolvedValue(createBacktest({ status }));

        await expect(service.cancelBacktest(user, 'backtest-1')).rejects.toBeInstanceOf(BadRequestException);
      }
    );

    it('wraps unexpected errors as InternalServerErrorException', async () => {
      const { service, coreRepository } = createService();
      coreRepository.fetchBacktestEntity.mockRejectedValue(new Error('db boom'));

      await expect(service.cancelBacktest(user, 'backtest-1')).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe('pauseBacktest', () => {
    const runningLiveReplay = () => createBacktest({ status: BacktestStatus.RUNNING, type: BacktestType.LIVE_REPLAY });

    it('sets pause flag and publishes status + log', async () => {
      const { service, coreRepository, backtestPauseService, backtestStream } = createService();
      coreRepository.fetchBacktestEntity.mockResolvedValue(runningLiveReplay());

      await service.pauseBacktest(user, 'backtest-1');

      expect(backtestPauseService.setPauseFlag).toHaveBeenCalledWith('backtest-1');
      expect(backtestStream.publishStatus).toHaveBeenCalledWith(
        'backtest-1',
        'pause_requested',
        undefined,
        expect.objectContaining({ requestedAt: expect.any(String) })
      );
      expect(backtestStream.publishLog).toHaveBeenCalledWith('backtest-1', 'info', expect.stringContaining('Pause'));
    });

    it('rejects pause when not running', async () => {
      const { service, coreRepository } = createService();
      coreRepository.fetchBacktestEntity.mockResolvedValue(
        createBacktest({ status: BacktestStatus.PAUSED, type: BacktestType.LIVE_REPLAY })
      );

      await expect(service.pauseBacktest(user, 'backtest-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects pause for non LIVE_REPLAY backtest types', async () => {
      const { service, coreRepository, backtestPauseService } = createService();
      coreRepository.fetchBacktestEntity.mockResolvedValue(
        createBacktest({ status: BacktestStatus.RUNNING, type: BacktestType.HISTORICAL })
      );

      await expect(service.pauseBacktest(user, 'backtest-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(backtestPauseService.setPauseFlag).not.toHaveBeenCalled();
    });

    it('swallows stream publish errors', async () => {
      const { service, coreRepository, backtestStream } = createService();
      coreRepository.fetchBacktestEntity.mockResolvedValue(runningLiveReplay());
      backtestStream.publishStatus.mockRejectedValueOnce(new Error('redis down'));

      await expect(service.pauseBacktest(user, 'backtest-1')).resolves.toBeUndefined();
    });

    it('wraps unexpected errors as InternalServerErrorException', async () => {
      const { service, coreRepository } = createService();
      coreRepository.fetchBacktestEntity.mockRejectedValue(new Error('db boom'));

      await expect(service.pauseBacktest(user, 'backtest-1')).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe('getBacktestProgress', () => {
    it('returns 100% for COMPLETED with totalTrades', async () => {
      const { service, coreRepository } = createService();
      coreRepository.fetchBacktestEntity.mockResolvedValue(
        createBacktest({ status: BacktestStatus.COMPLETED, totalTrades: 42 })
      );

      const result = await service.getBacktestProgress(user, 'backtest-1');

      expect(result).toEqual({ progress: 100, message: 'Backtest completed successfully', tradesExecuted: 42 });
    });

    it('computes actual progress from checkpoint for RUNNING', async () => {
      const { service, coreRepository } = createService();
      coreRepository.fetchBacktestEntity.mockResolvedValue(createBacktest({ status: BacktestStatus.RUNNING }));

      const result = await service.getBacktestProgress(user, 'backtest-1');

      expect(result.progress).toBe(10);
      expect(result.tradesExecuted).toBe(4);
      expect(result.currentDate).toEqual(new Date('2024-01-01T00:00:00.000Z'));
      expect(result.message).toContain('10');
    });

    it('falls back to 50% for RUNNING without checkpoint progress', async () => {
      const { service, coreRepository } = createService();
      coreRepository.fetchBacktestEntity.mockResolvedValue(
        createBacktest({
          status: BacktestStatus.RUNNING,
          processedTimestampCount: 0,
          totalTimestampCount: 0,
          checkpointState: undefined
        })
      );

      const result = await service.getBacktestProgress(user, 'backtest-1');

      expect(result.progress).toBe(50);
      expect(result.message).toBe('Backtest in progress...');
    });

    it('returns queued message for PENDING', async () => {
      const { service, coreRepository } = createService();
      coreRepository.fetchBacktestEntity.mockResolvedValue(
        createBacktest({
          status: BacktestStatus.PENDING,
          processedTimestampCount: 0,
          totalTimestampCount: 0,
          checkpointState: undefined
        })
      );

      const result = await service.getBacktestProgress(user, 'backtest-1');

      expect(result).toEqual({ progress: 0, message: 'Backtest queued for processing' });
    });

    it('returns paused message with progress for PAUSED', async () => {
      const { service, coreRepository } = createService();
      coreRepository.fetchBacktestEntity.mockResolvedValue(createBacktest({ status: BacktestStatus.PAUSED }));

      const result = await service.getBacktestProgress(user, 'backtest-1');

      expect(result.progress).toBe(10);
      expect(result.message).toContain('Paused');
    });

    it('includes errorMessage for FAILED', async () => {
      const { service, coreRepository } = createService();
      coreRepository.fetchBacktestEntity.mockResolvedValue(
        createBacktest({ status: BacktestStatus.FAILED, errorMessage: 'OOM' } as any)
      );

      const result = await service.getBacktestProgress(user, 'backtest-1');

      expect(result.message).toBe('Backtest failed: OOM');
    });

    it('returns cancelled message for CANCELLED', async () => {
      const { service, coreRepository } = createService();
      coreRepository.fetchBacktestEntity.mockResolvedValue(createBacktest({ status: BacktestStatus.CANCELLED }));

      const result = await service.getBacktestProgress(user, 'backtest-1');

      expect(result.message).toContain('Cancelled at 10%');
    });
  });
});
