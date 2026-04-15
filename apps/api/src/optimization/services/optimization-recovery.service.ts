import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { In, type QueryDeepPartialEntity, Repository } from 'typeorm';

import { GridSearchService } from './grid-search.service';

import { toErrorInfo } from '../../shared/error.util';
import { OptimizationRun, OptimizationStatus } from '../entities/optimization-run.entity';

/** Must match the watchdog threshold in BacktestOrchestrationTask */
const STALE_HEARTBEAT_THRESHOLD_MS = 360 * 60 * 1000; // 6 hours

/** Maximum number of automatic recovery attempts before permanently failing */
const MAX_AUTO_RESUME_COUNT = 3;

@Injectable()
export class OptimizationRecoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OptimizationRecoveryService.name);

  constructor(
    @InjectRepository(OptimizationRun) private readonly optimizationRunRepository: Repository<OptimizationRun>,
    @InjectQueue('optimization') private readonly optimizationQueue: Queue,
    private readonly gridSearchService: GridSearchService
  ) {}

  onApplicationBootstrap(): void {
    this.recoverOrphanedOptimizationRuns().catch((error: unknown) => {
      const err = toErrorInfo(error);
      this.logger.error(`Background optimization recovery failed: ${err.message}`, err.stack);
    });
  }

  /**
   * Find orphaned RUNNING/PENDING optimization runs after a restart and re-queue them.
   * Runs resume from their last completed batch via persisted optimization_results.
   */
  private async recoverOrphanedOptimizationRuns(): Promise<void> {
    this.logger.log('Checking for orphaned optimization runs to recover...');

    try {
      const orphaned = await this.optimizationRunRepository
        .createQueryBuilder('run')
        .addSelect('run.combinations')
        .where({ status: In([OptimizationStatus.RUNNING, OptimizationStatus.PENDING]) })
        .getMany();

      if (orphaned.length === 0) {
        this.logger.log('No orphaned optimization runs found');
        return;
      }

      this.logger.log(`Found ${orphaned.length} orphaned optimization run(s) to recover`);

      for (const run of orphaned) {
        try {
          await this.recoverSingleRun(run);
        } catch (error: unknown) {
          const err = toErrorInfo(error);
          this.logger.error(`Failed to recover optimization run ${run.id}: ${err.message}`, err.stack);
          try {
            await this.optimizationRunRepository.update(
              { id: run.id, status: In([OptimizationStatus.RUNNING, OptimizationStatus.PENDING]) },
              {
                status: OptimizationStatus.FAILED,
                errorMessage: `Recovery failed: ${err.message}`,
                completedAt: new Date()
              }
            );
          } catch (markError: unknown) {
            const markErr = toErrorInfo(markError);
            this.logger.error(`Failed to mark optimization run ${run.id} as failed: ${markErr.message}`);
          }
        }
      }

      this.logger.log('Optimization recovery check complete');
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Optimization recovery check failed: ${err.message}`, err.stack);
    }
  }

  private async recoverSingleRun(run: OptimizationRun): Promise<void> {
    // For PENDING runs, check if a valid job still exists in the queue
    if (run.status === OptimizationStatus.PENDING) {
      const existingJob = await this.optimizationQueue.getJob(run.id);
      if (existingJob) {
        const jobState = await existingJob.getState();
        if (jobState === 'waiting' || jobState === 'delayed') {
          this.logger.log(`Skipping PENDING optimization run ${run.id} — valid job exists (state: ${jobState})`);
          return;
        }
      }
    }

    // For RUNNING runs, check heartbeat freshness — another node may still be processing this run
    if (run.status === OptimizationStatus.RUNNING && run.lastHeartbeatAt) {
      const msSinceHeartbeat = Date.now() - run.lastHeartbeatAt.getTime();
      if (msSinceHeartbeat < STALE_HEARTBEAT_THRESHOLD_MS) {
        this.logger.log(
          `Skipping RUNNING optimization run ${run.id} — heartbeat is fresh ` +
            `(${Math.round(msSinceHeartbeat / 60000)} min ago, threshold: ${Math.round(STALE_HEARTBEAT_THRESHOLD_MS / 60000)} min)`
        );
        return;
      }
    }

    // Guard against infinite recovery loops
    const autoResumeCount = run.progressDetails?.autoResumeCount ?? 0;
    if (autoResumeCount >= MAX_AUTO_RESUME_COUNT) {
      this.logger.warn(
        `Optimization run ${run.id} has reached max auto-resume count ` +
          `(${autoResumeCount}/${MAX_AUTO_RESUME_COUNT}), marking FAILED`
      );
      await this.optimizationRunRepository.update(
        { id: run.id, status: In([OptimizationStatus.RUNNING, OptimizationStatus.PENDING]) },
        {
          status: OptimizationStatus.FAILED,
          errorMessage: `Exceeded maximum automatic recovery attempts (${MAX_AUTO_RESUME_COUNT})`,
          completedAt: new Date()
        }
      );
      return;
    }

    // Resolve combinations: prefer stored, fallback to regeneration for grid_search
    let combinations = run.combinations;
    if (!combinations) {
      if (run.config.method === 'random_search') {
        throw new Error(
          'Cannot resume random_search optimization without stored combinations (created before checkpoint-resume support)'
        );
      }
      // Grid search is deterministic — regenerate from parameter space
      combinations = this.gridSearchService.generateCombinations(run.parameterSpace, run.config.maxCombinations);
      this.logger.log(`Regenerated ${combinations.length} grid_search combinations for optimization run ${run.id}`);
    }

    // Remove any existing job with the same ID to prevent BullMQ jobId collision
    await this.forceRemoveJob(run.id);

    // Increment autoResumeCount in progressDetails
    const updatedProgressDetails = {
      ...(run.progressDetails ?? {}),
      autoResumeCount: autoResumeCount + 1
    };

    // Update DB to PENDING BEFORE enqueuing the job.
    // BullMQ workers are already active (started in onModuleInit, before onApplicationBootstrap),
    // so if we enqueue first, the worker can pick up the job before the DB update executes.
    const result = await this.optimizationRunRepository.update(
      { id: run.id, status: In([OptimizationStatus.RUNNING, OptimizationStatus.PENDING]) },
      {
        status: OptimizationStatus.PENDING,
        progressDetails: updatedProgressDetails
      } as QueryDeepPartialEntity<OptimizationRun>
    );

    if (result.affected === 0) {
      this.logger.log(`Optimization run ${run.id} already claimed by another node, skipping`);
      return;
    }

    await this.optimizationQueue.add(
      'run-optimization',
      { runId: run.id, combinations },
      {
        jobId: run.id,
        removeOnComplete: true,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 }
      }
    );

    this.logger.log(
      `Re-queued optimization run ${run.id} for recovery ` +
        `(attempt ${autoResumeCount + 1}/${MAX_AUTO_RESUME_COUNT}, ` +
        `progress: ${run.combinationsTested}/${run.totalCombinations})`
    );
  }

  /**
   * Force-remove a job from the queue, clearing stale locks from dead workers if needed.
   * After a deployment, the old worker process is gone but its Redis lock on active jobs
   * persists until lockDuration expires. job.remove() fails on locked jobs, so we delete
   * the lock key directly and retry.
   */
  private async forceRemoveJob(jobId: string): Promise<void> {
    const existingJob = await this.optimizationQueue.getJob(jobId);
    if (!existingJob) return;

    try {
      await existingJob.remove();
      this.logger.log(`Removed existing job ${jobId} from queue before re-queuing`);
      return;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.log(`Initial remove for job ${jobId} failed (${err.message}), attempting force-remove`);
    }

    // Force-remove the stale lock via Redis and retry
    try {
      const client = await this.optimizationQueue.client;
      const prefix = this.optimizationQueue.opts?.prefix ?? 'bull';
      const lockKey = `${prefix}:${this.optimizationQueue.name}:${jobId}:lock`;
      const deleted = await client.del(lockKey);
      this.logger.log(`Force-deleted stale lock for job ${jobId} (keys removed: ${deleted})`);

      await existingJob.remove();
      this.logger.log(`Removed previously-locked job ${jobId} after clearing stale lock`);
    } catch (forceError: unknown) {
      const err = toErrorInfo(forceError);
      this.logger.warn(`Could not force-remove job ${jobId}: ${err.message}`);
      throw new Error(`Cannot remove stale job ${jobId} from queue: ${err.message}`);
    }
  }
}
