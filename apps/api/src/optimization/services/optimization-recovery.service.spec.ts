import { type Queue } from 'bullmq';
import { In, type Repository } from 'typeorm';

import { type GridSearchService } from './grid-search.service';
import { OptimizationRecoveryService } from './optimization-recovery.service';

import { type OptimizationRun, OptimizationStatus } from '../entities/optimization-run.entity';

type MockRepo = jest.Mocked<Pick<Repository<OptimizationRun>, 'find' | 'update' | 'createQueryBuilder'>>;

const makeRun = (overrides: Partial<OptimizationRun> = {}): OptimizationRun =>
  ({
    id: 'run-1',
    status: OptimizationStatus.RUNNING,
    combinationsTested: 0,
    totalCombinations: 100,
    config: { method: 'grid_search' },
    parameterSpace: { strategyType: 'test', parameters: [] },
    combinations: [{ index: 0, values: { period: 14 }, isBaseline: true }],
    progressDetails: null,
    ...overrides
  }) as unknown as OptimizationRun;

describe('OptimizationRecoveryService', () => {
  let service: OptimizationRecoveryService;
  let repo: MockRepo;
  let queue: jest.Mocked<Pick<Queue, 'getJob' | 'add' | 'client' | 'opts' | 'name'>>;
  let gridSearchService: jest.Mocked<Pick<GridSearchService, 'generateCombinations'>>;

  beforeEach(() => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn().mockReturnValue({
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([])
      })
    };

    queue = {
      getJob: jest.fn().mockResolvedValue(undefined),
      add: jest.fn().mockResolvedValue(undefined),
      client: Promise.resolve({ del: jest.fn().mockResolvedValue(1) }),
      opts: { prefix: 'bull' },
      name: 'optimization'
    } as any;

    gridSearchService = {
      generateCombinations: jest.fn().mockReturnValue([{ index: 0, values: {}, isBaseline: true }])
    };

    service = new OptimizationRecoveryService(
      repo as unknown as Repository<OptimizationRun>,
      queue as unknown as Queue,
      gridSearchService as unknown as GridSearchService
    );
  });

  const recover = (svc: OptimizationRecoveryService) =>
    (svc as unknown as { recoverOrphanedOptimizationRuns: () => Promise<void> }).recoverOrphanedOptimizationRuns();

  /** Helper: configure createQueryBuilder mock to return given runs */
  const mockOrphanedRuns = (runs: OptimizationRun[]) => {
    repo.createQueryBuilder.mockReturnValue({
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(runs)
    } as any);
  };

  /** Helper: configure createQueryBuilder mock to reject */
  const mockOrphanedRunsRejected = (error: Error) => {
    repo.createQueryBuilder.mockReturnValue({
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockRejectedValue(error)
    } as any);
  };

  it('should do nothing when no orphaned runs exist', async () => {
    mockOrphanedRuns([]);

    await recover(service);

    expect(repo.update).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it.each(['waiting', 'delayed'] as const)('should skip PENDING run with valid %s job', async (jobState) => {
    const run = makeRun({ status: OptimizationStatus.PENDING });
    mockOrphanedRuns([run]);
    queue.getJob.mockResolvedValue({ getState: jest.fn().mockResolvedValue(jobState) } as never);

    await recover(service);

    expect(queue.getJob).toHaveBeenCalledWith(run.id);
    expect(repo.update).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('should skip RUNNING run with fresh heartbeat', async () => {
    const run = makeRun({
      status: OptimizationStatus.RUNNING,
      lastHeartbeatAt: new Date(Date.now() - 30 * 60 * 1000) // 30 min ago
    });
    mockOrphanedRuns([run]);

    await recover(service);

    expect(repo.update).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('should re-queue RUNNING run with stale heartbeat', async () => {
    const run = makeRun({
      status: OptimizationStatus.RUNNING,
      combinationsTested: 10,
      totalCombinations: 100,
      lastHeartbeatAt: new Date(Date.now() - 400 * 60 * 1000) // 400 min ago
    });
    mockOrphanedRuns([run]);

    await recover(service);

    // Should update to PENDING first
    expect(repo.update).toHaveBeenCalledWith(
      { id: run.id, status: In([OptimizationStatus.RUNNING, OptimizationStatus.PENDING]) },
      expect.objectContaining({
        status: OptimizationStatus.PENDING,
        progressDetails: expect.objectContaining({ autoResumeCount: 1 })
      })
    );
    // Then enqueue
    expect(queue.add).toHaveBeenCalledWith(
      'run-optimization',
      expect.objectContaining({ runId: run.id, combinations: run.combinations }),
      expect.objectContaining({ jobId: run.id })
    );
  });

  it('should re-queue PENDING run with no job', async () => {
    const run = makeRun({ status: OptimizationStatus.PENDING });
    mockOrphanedRuns([run]);
    queue.getJob.mockResolvedValue(undefined);

    await recover(service);

    expect(repo.update).toHaveBeenCalledWith(
      { id: run.id, status: In([OptimizationStatus.RUNNING, OptimizationStatus.PENDING]) },
      expect.objectContaining({ status: OptimizationStatus.PENDING })
    );
    expect(queue.add).toHaveBeenCalledWith(
      'run-optimization',
      expect.objectContaining({ runId: run.id }),
      expect.objectContaining({ jobId: run.id })
    );
  });

  it('should re-queue PENDING run with stuck active job after force-removing', async () => {
    const run = makeRun({ status: OptimizationStatus.PENDING });
    mockOrphanedRuns([run]);

    // First getJob returns active job (for skip check), second returns stale job (for force-remove)
    const mockJob = { getState: jest.fn().mockResolvedValue('active'), remove: jest.fn().mockResolvedValue(undefined) };
    queue.getJob.mockResolvedValue(mockJob as never);

    await recover(service);

    expect(mockJob.remove).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith(
      'run-optimization',
      expect.objectContaining({ runId: run.id }),
      expect.objectContaining({ jobId: run.id })
    );
  });

  it('should mark FAILED when auto-resume count exceeds limit', async () => {
    const run = makeRun({
      status: OptimizationStatus.RUNNING,
      progressDetails: { autoResumeCount: 3 } as any
    });
    mockOrphanedRuns([run]);

    await recover(service);

    expect(repo.update).toHaveBeenCalledWith(
      { id: run.id, status: In([OptimizationStatus.RUNNING, OptimizationStatus.PENDING]) },
      expect.objectContaining({
        status: OptimizationStatus.FAILED,
        errorMessage: expect.stringContaining('maximum automatic recovery attempts')
      })
    );
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('should regenerate combinations for grid_search when not stored', async () => {
    const run = makeRun({
      status: OptimizationStatus.RUNNING,
      combinations: undefined as any
    });
    mockOrphanedRuns([run]);

    const regenerated = [{ index: 0, values: { period: 14 }, isBaseline: true }];
    gridSearchService.generateCombinations.mockReturnValue(regenerated);

    await recover(service);

    expect(gridSearchService.generateCombinations).toHaveBeenCalledWith(run.parameterSpace, run.config.maxCombinations);
    expect(queue.add).toHaveBeenCalledWith(
      'run-optimization',
      expect.objectContaining({ combinations: regenerated }),
      expect.any(Object)
    );
  });

  it('should fail random_search without stored combinations', async () => {
    const run = makeRun({
      status: OptimizationStatus.RUNNING,
      config: { method: 'random_search' } as any,
      combinations: undefined as any
    });
    mockOrphanedRuns([run]);

    await recover(service);

    // Recovery error should cause the inner catch to mark it FAILED
    expect(repo.update).toHaveBeenCalledWith(
      { id: run.id, status: In([OptimizationStatus.RUNNING, OptimizationStatus.PENDING]) },
      expect.objectContaining({
        status: OptimizationStatus.FAILED,
        errorMessage: expect.stringContaining('random_search')
      })
    );
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('should update DB to PENDING before enqueuing (ordering)', async () => {
    const run = makeRun({ status: OptimizationStatus.RUNNING });
    mockOrphanedRuns([run]);

    const callOrder: string[] = [];
    repo.update.mockImplementation(async () => {
      callOrder.push('db-update');
      return { affected: 1, raw: [], generatedMaps: [] };
    });
    queue.add.mockImplementation(async () => {
      callOrder.push('queue-add');
      return {} as any;
    });

    await recover(service);

    expect(callOrder).toEqual(['db-update', 'queue-add']);
  });

  it('should increment autoResumeCount from existing value', async () => {
    const run = makeRun({
      status: OptimizationStatus.RUNNING,
      progressDetails: { autoResumeCount: 2 } as any
    });
    mockOrphanedRuns([run]);

    await recover(service);

    // autoResumeCount = 2 < 3 (MAX), so should re-queue with count = 3
    expect(repo.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: OptimizationStatus.PENDING,
        progressDetails: expect.objectContaining({ autoResumeCount: 3 })
      })
    );
  });

  it('should force-remove stale Redis lock when initial remove fails', async () => {
    const run = makeRun({ status: OptimizationStatus.RUNNING });
    mockOrphanedRuns([run]);

    const mockDel = jest.fn().mockResolvedValue(1);
    (queue as any).client = Promise.resolve({ del: mockDel });

    const mockJob = {
      getState: jest.fn().mockResolvedValue('active'),
      remove: jest.fn().mockRejectedValueOnce(new Error('Could not remove lock')).mockResolvedValueOnce(undefined)
    };
    queue.getJob.mockResolvedValue(mockJob as never);

    await recover(service);

    expect(mockDel).toHaveBeenCalledWith('bull:optimization:run-1:lock');
    expect(mockJob.remove).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalled();
  });

  it('should mark FAILED when both job remove attempts fail', async () => {
    const run = makeRun({ status: OptimizationStatus.RUNNING });
    mockOrphanedRuns([run]);

    const mockDel = jest.fn().mockResolvedValue(0);
    (queue as any).client = Promise.resolve({ del: mockDel });

    const mockJob = {
      getState: jest.fn().mockResolvedValue('active'),
      remove: jest.fn().mockRejectedValue(new Error('locked'))
    };
    queue.getJob.mockResolvedValue(mockJob as never);

    await recover(service);

    // Run should be marked FAILED (not re-queued)
    expect(repo.update).toHaveBeenCalledWith(
      { id: run.id, status: In([OptimizationStatus.RUNNING, OptimizationStatus.PENDING]) },
      expect.objectContaining({
        status: OptimizationStatus.FAILED,
        errorMessage: expect.stringContaining('Cannot remove stale job')
      })
    );
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('should skip re-queue when another node already claimed the run', async () => {
    const run = makeRun({ status: OptimizationStatus.RUNNING });
    mockOrphanedRuns([run]);

    repo.update.mockResolvedValue({ affected: 0, raw: [], generatedMaps: [] });

    await recover(service);

    expect(repo.update).toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('should continue to next run when recovery error occurs on one run', async () => {
    const run1 = makeRun({ id: 'run-1', status: OptimizationStatus.RUNNING });
    const run2 = makeRun({ id: 'run-2', status: OptimizationStatus.RUNNING });
    mockOrphanedRuns([run1, run2]);

    // First update (recoverSingleRun for run1) throws, inner catch succeeds
    let callCount = 0;
    repo.update.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error('simulated failure');
      return { affected: 1, raw: [], generatedMaps: [] };
    });

    await recover(service);

    // Inner catch marks run1 as FAILED (call 2), then run2 is recovered (call 3)
    expect(repo.update).toHaveBeenCalledTimes(3);
    expect(queue.add).toHaveBeenCalledWith(
      'run-optimization',
      expect.objectContaining({ runId: 'run-2' }),
      expect.any(Object)
    );
  });

  it('should not crash when inner catch also throws', async () => {
    const run = makeRun({ status: OptimizationStatus.RUNNING });
    mockOrphanedRuns([run]);

    repo.update.mockRejectedValue(new Error('all updates fail'));

    await expect(recover(service)).resolves.toBeUndefined();
  });

  it('should not crash when top-level find throws', async () => {
    mockOrphanedRunsRejected(new Error('database unavailable'));

    await expect(recover(service)).resolves.toBeUndefined();
  });
});
