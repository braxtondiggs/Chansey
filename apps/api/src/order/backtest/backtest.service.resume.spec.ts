import { BadRequestException } from '@nestjs/common';

import { DEFAULT_CHECKPOINT_CONFIG } from './backtest-checkpoint.interface';
import { Backtest, BacktestStatus, BacktestType } from './backtest.entity';
import { BacktestService } from './backtest.service';

describe('BacktestService.resumeBacktest', () => {
  const createService = () => {
    const backtestStream = { publishStatus: jest.fn() };
    const backtestRepository = { save: jest.fn() };
    const queue = { add: jest.fn() };
    const datasetValidator = { validateDataset: jest.fn() };
    const backtestPauseService = { clearPauseFlag: jest.fn(), setPauseFlag: jest.fn(), isPauseRequested: jest.fn() };

    const service = new BacktestService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      backtestStream as any,
      {} as any,
      datasetValidator as any,
      backtestRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      queue as any,
      queue as any,
      backtestPauseService as any
    );

    return { service, backtestStream, backtestRepository, queue };
  };

  const createBacktest = (overrides: Partial<Backtest> = {}): Backtest =>
    ({
      id: 'backtest-1',
      status: BacktestStatus.PAUSED,
      type: BacktestType.HISTORICAL,
      deterministicSeed: 'seed-1',
      processedTimestampCount: 10,
      totalTimestampCount: 100,
      checkpointState: {
        lastProcessedIndex: 9,
        lastProcessedTimestamp: '2024-01-01T00:00:00.000Z',
        rngState: 123,
        portfolio: { cashBalance: 1000, positions: [] },
        peakValue: 1100,
        maxDrawdown: 0,
        persistedCounts: { trades: 1, signals: 1, fills: 1, snapshots: 1 },
        checksum: 'checksum'
      },
      lastCheckpointAt: new Date(),
      user: { id: 'user-1' },
      algorithm: { id: 'algo-1' },
      marketDataSet: { id: 'dataset-1' },
      ...overrides
    }) as Backtest;

  it('resumes with a valid checkpoint and publishes resume status', async () => {
    const { service, backtestStream, backtestRepository, queue } = createService();
    const backtest = createBacktest();

    (service as any).fetchBacktestEntity = jest.fn().mockResolvedValue(backtest);
    (service as any).buildJobPayload = jest.fn().mockReturnValue({ payload: true });
    (service as any).getQueueForType = jest.fn().mockReturnValue(queue);

    await service.resumeBacktest({ id: 'user-1' } as any, backtest.id);

    expect(backtest.status).toBe(BacktestStatus.PENDING);
    expect(backtestRepository.save).toHaveBeenCalledWith(backtest);
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
    const { service, backtestStream, backtestRepository, queue } = createService();
    const backtest = createBacktest({
      lastCheckpointAt: new Date(Date.now() - DEFAULT_CHECKPOINT_CONFIG.maxCheckpointAge - 1000)
    });

    (service as any).fetchBacktestEntity = jest.fn().mockResolvedValue(backtest);
    (service as any).buildJobPayload = jest.fn().mockReturnValue({ payload: true });
    (service as any).getQueueForType = jest.fn().mockReturnValue(queue);

    await service.resumeBacktest({ id: 'user-1' } as any, backtest.id);

    expect(backtest.checkpointState).toBeUndefined();
    expect(backtest.lastCheckpointAt).toBeUndefined();
    expect(backtest.processedTimestampCount).toBe(0);
    expect(backtestRepository.save).toHaveBeenCalledWith(backtest);
    expect(backtestStream.publishStatus).toHaveBeenCalledWith(backtest.id, 'queued', undefined, {
      resumed: true,
      hasCheckpoint: false,
      checkpointIndex: undefined
    });
  });

  it('rejects resume attempts from non-resumable statuses', async () => {
    const { service } = createService();
    const backtest = createBacktest({ status: BacktestStatus.COMPLETED });

    (service as any).fetchBacktestEntity = jest.fn().mockResolvedValue(backtest);

    await expect(service.resumeBacktest({ id: 'user-1' } as any, backtest.id)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });
});
