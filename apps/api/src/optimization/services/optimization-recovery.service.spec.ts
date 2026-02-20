import { EventEmitter2 } from '@nestjs/event-emitter';

import { Queue } from 'bullmq';
import { In, Repository } from 'typeorm';

import { OptimizationRecoveryService } from './optimization-recovery.service';

import { PIPELINE_EVENTS } from '../../pipeline/interfaces';
import { OptimizationRun, OptimizationStatus } from '../entities/optimization-run.entity';

type MockRepo = jest.Mocked<Pick<Repository<OptimizationRun>, 'find' | 'update'>>;

const makeRun = (overrides: Partial<OptimizationRun> = {}): OptimizationRun =>
  ({
    id: 'run-1',
    status: OptimizationStatus.RUNNING,
    combinationsTested: 0,
    totalCombinations: 100,
    ...overrides
  }) as OptimizationRun;

describe('OptimizationRecoveryService', () => {
  let service: OptimizationRecoveryService;
  let repo: MockRepo;
  let queue: jest.Mocked<Pick<Queue, 'getJob'>>;
  let eventEmitter: jest.Mocked<Pick<EventEmitter2, 'emit'>>;

  beforeEach(() => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 })
    };

    queue = {
      getJob: jest.fn().mockResolvedValue(undefined)
    };

    eventEmitter = {
      emit: jest.fn()
    };

    // Direct constructor instantiation to avoid onApplicationBootstrap firing
    service = new OptimizationRecoveryService(
      repo as unknown as Repository<OptimizationRun>,
      queue as unknown as Queue,
      eventEmitter as unknown as EventEmitter2
    );
  });

  // Access private method for testing
  const recover = (svc: OptimizationRecoveryService) =>
    (svc as unknown as { recoverOrphanedOptimizationRuns: () => Promise<void> }).recoverOrphanedOptimizationRuns();

  it('should do nothing when no orphaned runs exist', async () => {
    repo.find.mockResolvedValue([]);

    await recover(service);

    expect(repo.update).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it.each(['waiting', 'delayed'] as const)('should skip PENDING run with valid %s job', async (jobState) => {
    const run = makeRun({ status: OptimizationStatus.PENDING });
    repo.find.mockResolvedValue([run]);
    queue.getJob.mockResolvedValue({ getState: jest.fn().mockResolvedValue(jobState) } as never);

    await recover(service);

    expect(queue.getJob).toHaveBeenCalledWith(run.id);
    expect(repo.update).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('should mark PENDING run with no job as FAILED and emit event', async () => {
    const run = makeRun({ status: OptimizationStatus.PENDING });
    repo.find.mockResolvedValue([run]);
    queue.getJob.mockResolvedValue(undefined);

    await recover(service);

    expect(repo.update).toHaveBeenCalledWith(
      { id: run.id, status: In([OptimizationStatus.RUNNING, OptimizationStatus.PENDING]) },
      expect.objectContaining({
        status: OptimizationStatus.FAILED,
        errorMessage: expect.stringContaining('job lost from queue'),
        completedAt: expect.any(Date)
      })
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      PIPELINE_EVENTS.OPTIMIZATION_FAILED,
      expect.objectContaining({ runId: run.id })
    );
  });

  it('should mark PENDING run with stuck active job as FAILED and emit event', async () => {
    const run = makeRun({ status: OptimizationStatus.PENDING });
    repo.find.mockResolvedValue([run]);
    queue.getJob.mockResolvedValue({ getState: jest.fn().mockResolvedValue('active') } as never);

    await recover(service);

    expect(repo.update).toHaveBeenCalledWith(
      { id: run.id, status: In([OptimizationStatus.RUNNING, OptimizationStatus.PENDING]) },
      expect.objectContaining({ status: OptimizationStatus.FAILED })
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      PIPELINE_EVENTS.OPTIMIZATION_FAILED,
      expect.objectContaining({ runId: run.id })
    );
  });

  it('should skip RUNNING run with fresh heartbeat', async () => {
    const run = makeRun({
      status: OptimizationStatus.RUNNING,
      lastHeartbeatAt: new Date(Date.now() - 30 * 60 * 1000) // 30 min ago — well within 120 min threshold
    });
    repo.find.mockResolvedValue([run]);

    await recover(service);

    expect(repo.update).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('should fail RUNNING run with stale heartbeat', async () => {
    const run = makeRun({
      status: OptimizationStatus.RUNNING,
      combinationsTested: 10,
      totalCombinations: 100,
      lastHeartbeatAt: new Date(Date.now() - 150 * 60 * 1000) // 150 min ago — beyond 120 min threshold
    });
    repo.find.mockResolvedValue([run]);

    await recover(service);

    expect(repo.update).toHaveBeenCalledWith(
      { id: run.id, status: In([OptimizationStatus.RUNNING, OptimizationStatus.PENDING]) },
      expect.objectContaining({
        status: OptimizationStatus.FAILED,
        errorMessage: expect.stringContaining('partial progress'),
        completedAt: expect.any(Date)
      })
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      PIPELINE_EVENTS.OPTIMIZATION_FAILED,
      expect.objectContaining({ runId: run.id })
    );
  });

  it('should include "no progress" in reason for RUNNING run with 0 progress', async () => {
    const run = makeRun({ status: OptimizationStatus.RUNNING, combinationsTested: 0 });
    repo.find.mockResolvedValue([run]);

    await recover(service);

    expect(repo.update).toHaveBeenCalledWith(
      { id: run.id, status: In([OptimizationStatus.RUNNING, OptimizationStatus.PENDING]) },
      expect.objectContaining({
        status: OptimizationStatus.FAILED,
        errorMessage: expect.stringContaining('no progress'),
        completedAt: expect.any(Date)
      })
    );
  });

  it('should include combination counts in reason for RUNNING run with partial progress', async () => {
    const run = makeRun({ status: OptimizationStatus.RUNNING, combinationsTested: 42, totalCombinations: 100 });
    repo.find.mockResolvedValue([run]);

    await recover(service);

    expect(repo.update).toHaveBeenCalledWith(
      { id: run.id, status: In([OptimizationStatus.RUNNING, OptimizationStatus.PENDING]) },
      expect.objectContaining({
        status: OptimizationStatus.FAILED,
        errorMessage: expect.stringContaining('42/100'),
        completedAt: expect.any(Date)
      })
    );
  });

  it('should NOT emit event when affected === 0 (race guard)', async () => {
    const run = makeRun({ status: OptimizationStatus.RUNNING });
    repo.find.mockResolvedValue([run]);
    repo.update.mockResolvedValue({ affected: 0, raw: [], generatedMaps: [] });

    await recover(service);

    expect(repo.update).toHaveBeenCalledWith(
      { id: run.id, status: In([OptimizationStatus.RUNNING, OptimizationStatus.PENDING]) },
      expect.objectContaining({ status: OptimizationStatus.FAILED })
    );
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('should continue to next run when recovery error occurs on one run', async () => {
    const run1 = makeRun({ id: 'run-1', status: OptimizationStatus.RUNNING });
    const run2 = makeRun({ id: 'run-2', status: OptimizationStatus.RUNNING });
    repo.find.mockResolvedValue([run1, run2]);

    // First update (recoverSingleRun) throws, inner catch update succeeds
    let callCount = 0;
    repo.update.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error('simulated failure');
      return { affected: 1, raw: [], generatedMaps: [] };
    });

    await recover(service);

    // Inner catch should have tried to mark run1 as FAILED (call 2)
    // run2 should have been processed normally (call 3)
    expect(repo.update).toHaveBeenCalledTimes(3);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      PIPELINE_EVENTS.OPTIMIZATION_FAILED,
      expect.objectContaining({ runId: 'run-2' })
    );
  });

  it('should not crash when inner catch also throws', async () => {
    const run = makeRun({ status: OptimizationStatus.RUNNING });
    repo.find.mockResolvedValue([run]);

    // Both the recoverSingleRun and the inner catch update throw
    repo.update.mockRejectedValue(new Error('all updates fail'));

    // Should not throw
    await expect(recover(service)).resolves.toBeUndefined();
  });

  it('should not crash when top-level find throws', async () => {
    repo.find.mockRejectedValue(new Error('database unavailable'));

    // Should not throw — top-level catch handles it
    await expect(recover(service)).resolves.toBeUndefined();
  });
});
