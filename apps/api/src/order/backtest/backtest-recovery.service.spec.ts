import { Logger } from '@nestjs/common';

import { BacktestCheckpointState } from './backtest-checkpoint.interface';
import { BacktestRecoveryService } from './backtest-recovery.service';
import { Backtest, BacktestStatus, BacktestType } from './backtest.entity';

function makeBacktest(overrides: Partial<Backtest> = {}): Backtest {
  return {
    id: 'bt-1',
    status: BacktestStatus.RUNNING,
    type: BacktestType.HISTORICAL,
    user: { id: 'user-1' },
    algorithm: { id: 'algo-1' },
    marketDataSet: { id: 'ds-1' },
    configSnapshot: {},
    checkpointState: null,
    lastCheckpointAt: null,
    processedTimestampCount: 0,
    deterministicSeed: 'seed-1',
    ...overrides
  } as unknown as Backtest;
}

function makeCheckpoint(): BacktestCheckpointState {
  return {
    lastProcessedIndex: 100,
    lastProcessedTimestamp: new Date().toISOString(),
    portfolio: { cashBalance: 10000, positions: [] },
    peakValue: 10000,
    maxDrawdown: 0,
    rngState: 42,
    persistedCounts: { trades: 5, signals: 10, fills: 5, snapshots: 20 },
    checksum: 'abc123'
  };
}

/** Flush all pending microtasks so fire-and-forget promises settle */
const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('BacktestRecoveryService', () => {
  let backtestRepository: Record<string, jest.Mock>;
  let historicalQueue: Record<string, any>;
  let replayQueue: Record<string, any>;

  let redisClient: Record<string, jest.Mock>;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    redisClient = { del: jest.fn().mockResolvedValue(1) };

    backtestRepository = {
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined)
    };

    historicalQueue = {
      add: jest.fn().mockResolvedValue(undefined),
      getJob: jest.fn().mockResolvedValue(null),
      client: Promise.resolve(redisClient),
      opts: { prefix: 'bull' },
      name: 'backtest-historical'
    };

    replayQueue = {
      add: jest.fn().mockResolvedValue(undefined),
      getJob: jest.fn().mockResolvedValue(null),
      client: Promise.resolve(redisClient),
      opts: { prefix: 'bull' },
      name: 'backtest-replay'
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createService(): BacktestRecoveryService {
    return new BacktestRecoveryService(backtestRepository as any, historicalQueue as any, replayQueue as any);
  }

  it('logs "no orphaned" and returns when none found', async () => {
    backtestRepository.find.mockResolvedValue([]);

    const service = createService();
    service.onApplicationBootstrap();
    await flushPromises();

    expect(backtestRepository.find).toHaveBeenCalled();
    expect(historicalQueue.add).not.toHaveBeenCalled();
    expect(replayQueue.add).not.toHaveBeenCalled();
  });

  it('recovers with checkpoint, resets to PENDING and re-queues with correct payload', async () => {
    const checkpoint = makeCheckpoint();
    const backtest = makeBacktest({
      checkpointState: checkpoint,
      lastCheckpointAt: new Date()
    });
    backtestRepository.find.mockResolvedValue([backtest]);

    const service = createService();
    service.onApplicationBootstrap();
    await flushPromises();

    // Should update status to PENDING with incremented autoResumeCount
    expect(backtestRepository.update).toHaveBeenCalledWith('bt-1', {
      status: BacktestStatus.PENDING,
      configSnapshot: expect.objectContaining({ autoResumeCount: 1 }),
      checkpointState: checkpoint,
      lastCheckpointAt: expect.any(Date),
      processedTimestampCount: 0
    });

    // Should add to historical queue with correct payload
    expect(historicalQueue.add).toHaveBeenCalledWith(
      'execute-backtest',
      {
        backtestId: 'bt-1',
        userId: 'user-1',
        datasetId: 'ds-1',
        algorithmId: 'algo-1',
        deterministicSeed: 'seed-1',
        mode: BacktestType.HISTORICAL
      },
      { jobId: 'bt-1', removeOnComplete: true, removeOnFail: false }
    );

    // DB update to PENDING must happen before queue.add() to prevent race condition
    const updateOrder = backtestRepository.update.mock.invocationCallOrder[0];
    const addOrder = historicalQueue.add.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(addOrder);
  });

  it('recovers without checkpoint', async () => {
    const backtest = makeBacktest();
    backtestRepository.find.mockResolvedValue([backtest]);

    const service = createService();
    service.onApplicationBootstrap();
    await flushPromises();

    expect(backtestRepository.update).toHaveBeenCalledWith('bt-1', {
      status: BacktestStatus.PENDING,
      configSnapshot: expect.objectContaining({ autoResumeCount: 1 }),
      checkpointState: null,
      lastCheckpointAt: null,
      processedTimestampCount: 0
    });

    expect(historicalQueue.add).toHaveBeenCalled();

    // DB update to PENDING must happen before queue.add() to prevent race condition
    const updateOrder = backtestRepository.update.mock.invocationCallOrder[0];
    const addOrder = historicalQueue.add.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(addOrder);
  });

  it('clears stale checkpoint when age exceeds max', async () => {
    const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); // 8 days old
    const backtest = makeBacktest({
      checkpointState: makeCheckpoint(),
      lastCheckpointAt: staleDate,
      processedTimestampCount: 500
    });
    backtestRepository.find.mockResolvedValue([backtest]);

    const service = createService();
    service.onApplicationBootstrap();
    await flushPromises();

    // Stale checkpoint should be cleared
    expect(backtestRepository.update).toHaveBeenCalledWith('bt-1', {
      status: BacktestStatus.PENDING,
      configSnapshot: expect.objectContaining({ autoResumeCount: 1 }),
      checkpointState: null,
      lastCheckpointAt: null,
      processedTimestampCount: 0
    });
  });

  it('marks FAILED when max auto-resume count exceeded', async () => {
    const backtest = makeBacktest({
      configSnapshot: { autoResumeCount: 3 }
    });
    backtestRepository.find.mockResolvedValue([backtest]);

    const service = createService();
    service.onApplicationBootstrap();
    await flushPromises();

    expect(backtestRepository.update).toHaveBeenCalledWith('bt-1', {
      status: BacktestStatus.FAILED,
      errorMessage: expect.stringContaining('maximum automatic recovery attempts')
    });

    expect(historicalQueue.add).not.toHaveBeenCalled();
  });

  it('marks FAILED when required relations are missing', async () => {
    const backtest = makeBacktest({
      user: null,
      algorithm: null,
      marketDataSet: null,
      configSnapshot: {}
    });
    backtestRepository.find.mockResolvedValue([backtest]);

    const service = createService();
    service.onApplicationBootstrap();
    await flushPromises();

    // Should NOT update to PENDING (validation happens before status update)
    const updateCalls = backtestRepository.update.mock.calls;
    const pendingCall = updateCalls.find(([, data]) => data.status === BacktestStatus.PENDING);
    expect(pendingCall).toBeUndefined();

    // Should mark as FAILED via the outer catch
    const failedCall = updateCalls.find(([, data]) => data.status === BacktestStatus.FAILED);
    expect(failedCall).toBeDefined();
    expect(failedCall[1].errorMessage).toContain('Missing required relations');
  });

  it('marks FAILED when queue add fails', async () => {
    const backtest = makeBacktest();
    backtestRepository.find.mockResolvedValue([backtest]);
    historicalQueue.add.mockRejectedValue(new Error('Redis connection refused'));

    const service = createService();
    service.onApplicationBootstrap();
    await flushPromises();

    // With DB-first ordering, the PENDING update happens before queue.add() fails
    const pendingCall = backtestRepository.update.mock.calls.find(([, data]) => data.status === BacktestStatus.PENDING);
    expect(pendingCall).toBeDefined();

    // The outer catch should mark it FAILED
    const failedCall = backtestRepository.update.mock.calls.find(([, data]) => data.status === BacktestStatus.FAILED);
    expect(failedCall).toBeDefined();
    expect(failedCall[1].errorMessage).toContain('Redis connection refused');
  });

  it('continues recovering other backtests when one fails', async () => {
    const bt1 = makeBacktest({ id: 'bt-fail', user: null, configSnapshot: {} });
    const bt2 = makeBacktest({ id: 'bt-ok' });
    backtestRepository.find.mockResolvedValue([bt1, bt2]);

    const service = createService();
    service.onApplicationBootstrap();
    await flushPromises();

    // bt-fail should be marked FAILED
    const failedCall = backtestRepository.update.mock.calls.find(
      ([id, data]) => id === 'bt-fail' && data.status === BacktestStatus.FAILED
    );
    expect(failedCall).toBeDefined();

    // bt-ok should be successfully re-queued
    const pendingCall = backtestRepository.update.mock.calls.find(
      ([id, data]) => id === 'bt-ok' && data.status === BacktestStatus.PENDING
    );
    expect(pendingCall).toBeDefined();
    expect(historicalQueue.add).toHaveBeenCalledWith(
      'execute-backtest',
      expect.objectContaining({ backtestId: 'bt-ok' }),
      expect.any(Object)
    );
  });

  it('uses replay queue for LIVE_REPLAY type', async () => {
    const backtest = makeBacktest({ type: BacktestType.LIVE_REPLAY });
    backtestRepository.find.mockResolvedValue([backtest]);

    const service = createService();
    service.onApplicationBootstrap();
    await flushPromises();

    expect(replayQueue.add).toHaveBeenCalled();
    expect(historicalQueue.add).not.toHaveBeenCalled();
  });

  it('skips PENDING backtest when valid waiting job exists', async () => {
    const backtest = makeBacktest({ status: BacktestStatus.PENDING });
    backtestRepository.find.mockResolvedValue([backtest]);
    historicalQueue.getJob.mockResolvedValue({
      getState: jest.fn().mockResolvedValue('waiting')
    });

    const service = createService();
    service.onApplicationBootstrap();
    await flushPromises();

    expect(backtestRepository.update).not.toHaveBeenCalled();
    expect(historicalQueue.add).not.toHaveBeenCalled();
  });

  it('recovers orphaned PENDING backtest when no job exists', async () => {
    const backtest = makeBacktest({ status: BacktestStatus.PENDING });
    backtestRepository.find.mockResolvedValue([backtest]);
    historicalQueue.getJob.mockResolvedValue(null);

    const service = createService();
    service.onApplicationBootstrap();
    await flushPromises();

    // Should go through the normal recovery flow
    expect(historicalQueue.add).toHaveBeenCalledWith(
      'execute-backtest',
      expect.objectContaining({ backtestId: 'bt-1' }),
      expect.any(Object)
    );
    expect(backtestRepository.update).toHaveBeenCalledWith(
      'bt-1',
      expect.objectContaining({
        status: BacktestStatus.PENDING
      })
    );
  });

  it('recovers PENDING backtest when existing job is in failed state', async () => {
    const mockJob = {
      getState: jest.fn().mockResolvedValue('failed'),
      remove: jest.fn().mockResolvedValue(undefined)
    };
    const backtest = makeBacktest({ status: BacktestStatus.PENDING });
    backtestRepository.find.mockResolvedValue([backtest]);

    // First getJob call (PENDING guard) returns the failed job
    // Second getJob call (existing job removal) also returns the failed job
    historicalQueue.getJob.mockResolvedValue(mockJob);

    const service = createService();
    service.onApplicationBootstrap();
    await flushPromises();

    // Should remove the old failed job
    expect(mockJob.remove).toHaveBeenCalled();

    // Should re-queue
    expect(historicalQueue.add).toHaveBeenCalledWith(
      'execute-backtest',
      expect.objectContaining({ backtestId: 'bt-1' }),
      expect.any(Object)
    );

    // Should update DB to PENDING
    expect(backtestRepository.update).toHaveBeenCalledWith(
      'bt-1',
      expect.objectContaining({
        status: BacktestStatus.PENDING
      })
    );
  });

  it('recovers PENDING backtest when existing job is active (stale lock from dead worker)', async () => {
    const mockJob = {
      getState: jest.fn().mockResolvedValue('active'),
      remove: jest.fn().mockResolvedValue(undefined)
    };
    const backtest = makeBacktest({ status: BacktestStatus.PENDING });
    backtestRepository.find.mockResolvedValue([backtest]);
    historicalQueue.getJob.mockResolvedValue(mockJob);

    const service = createService();
    service.onApplicationBootstrap();
    await flushPromises();

    // Should NOT skip — active jobs after restart are stale
    expect(historicalQueue.add).toHaveBeenCalled();
    expect(backtestRepository.update).toHaveBeenCalledWith(
      'bt-1',
      expect.objectContaining({ status: BacktestStatus.PENDING })
    );
  });

  it('force-removes stale locked job via Redis when job.remove() fails', async () => {
    const mockJob = {
      remove: jest
        .fn()
        .mockRejectedValueOnce(new Error('Job bt-1 could not be removed because it is locked by another worker'))
        .mockResolvedValueOnce(undefined)
    };
    const backtest = makeBacktest();
    backtestRepository.find.mockResolvedValue([backtest]);
    historicalQueue.getJob.mockResolvedValue(mockJob);

    const service = createService();
    service.onApplicationBootstrap();
    await flushPromises();

    // Should delete the stale lock key via Redis
    expect(redisClient.del).toHaveBeenCalledWith('bull:backtest-historical:bt-1:lock');

    // Should retry remove after clearing the lock
    expect(mockJob.remove).toHaveBeenCalledTimes(2);

    // Should successfully re-queue
    expect(historicalQueue.add).toHaveBeenCalled();
  });
});
