import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { In, Repository } from 'typeorm';

import { PIPELINE_EVENTS } from '../../pipeline/interfaces';
import { toErrorInfo } from '../../shared/error.util';
import { OptimizationRun, OptimizationStatus } from '../entities/optimization-run.entity';

/** Must match the watchdog threshold in BacktestOrchestrationTask */
const STALE_HEARTBEAT_THRESHOLD_MS = 360 * 60 * 1000; // 6 hours

@Injectable()
export class OptimizationRecoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OptimizationRecoveryService.name);

  constructor(
    @InjectRepository(OptimizationRun) private readonly optimizationRunRepository: Repository<OptimizationRun>,
    @InjectQueue('optimization') private readonly optimizationQueue: Queue,
    private readonly eventEmitter: EventEmitter2
  ) {}

  onApplicationBootstrap(): void {
    this.recoverOrphanedOptimizationRuns().catch((error: unknown) => {
      const err = toErrorInfo(error);
      this.logger.error(`Background optimization recovery failed: ${err.message}`, err.stack);
    });
  }

  /**
   * Find orphaned RUNNING/PENDING optimization runs after a restart and mark them FAILED.
   * Unlike backtests, optimization runs do not support checkpoint-resume,
   * so any interrupted run must be failed and retried from scratch.
   */
  private async recoverOrphanedOptimizationRuns(): Promise<void> {
    this.logger.log('Checking for orphaned optimization runs to recover...');

    try {
      const orphaned = await this.optimizationRunRepository.find({
        where: {
          status: In([OptimizationStatus.RUNNING, OptimizationStatus.PENDING])
        }
      });

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

    const reason =
      run.status === OptimizationStatus.PENDING
        ? 'Container restart: job lost from queue before execution started'
        : run.combinationsTested === 0
          ? 'Container restart: no progress was made'
          : `Container restart: partial progress (${run.combinationsTested}/${run.totalCombinations} combinations)`;

    this.logger.warn(`Marking orphaned optimization run ${run.id} as FAILED: ${reason}`);

    const result = await this.optimizationRunRepository.update(
      { id: run.id, status: In([OptimizationStatus.RUNNING, OptimizationStatus.PENDING]) },
      {
        status: OptimizationStatus.FAILED,
        errorMessage: reason,
        completedAt: new Date()
      }
    );

    if (result.affected === 0) {
      this.logger.log(`Optimization run ${run.id} already transitioned — skipping event emission`);
      return;
    }

    // Emit failure event so pipeline listener can clean up
    this.eventEmitter.emit(PIPELINE_EVENTS.OPTIMIZATION_FAILED, {
      runId: run.id,
      reason
    });
  }
}
