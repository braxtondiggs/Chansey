import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';

import { Job, Queue } from 'bullmq';
import { Repository } from 'typeorm';

import { FailSafeWorkerHost } from '../../failed-jobs/fail-safe-worker-host';
import { FailedJobService } from '../../failed-jobs/failed-job.service';
import { toErrorInfo } from '../../shared/error.util';
import { ListingCandidate } from '../entities/listing-candidate.entity';
import { CrossListingScorerService } from '../services/cross-listing-scorer.service';
import { ListingTrackerService } from '../services/listing-tracker.service';

export const LISTING_SCORE_QUEUE = 'listing-score';
const SCORE_JOB_NAME = 'listing-score-run';

@Processor(LISTING_SCORE_QUEUE)
@Injectable()
export class ListingScoreTask extends FailSafeWorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ListingScoreTask.name);
  private jobScheduled = false;

  constructor(
    @InjectQueue(LISTING_SCORE_QUEUE) private readonly queue: Queue,
    @InjectRepository(ListingCandidate) private readonly candidateRepo: Repository<ListingCandidate>,
    private readonly scorer: CrossListingScorerService,
    private readonly tracker: ListingTrackerService,
    private readonly config: ConfigService,
    failedJobService: FailedJobService
  ) {
    super(failedJobService);
  }

  async onModuleInit() {
    if (this.isDisabled()) {
      this.logger.log('Listing scoring task disabled');
      return;
    }
    if (!this.jobScheduled) {
      await this.schedule();
      this.jobScheduled = true;
    }
  }

  private isDisabled(): boolean {
    if (process.env.DISABLE_BACKGROUND_TASKS === 'true') return true;
    if (process.env.NODE_ENV === 'development') return true;
    return this.config.get<string>('LISTING_TRACKER_ENABLED') !== 'true';
  }

  private async schedule(): Promise<void> {
    const existing = await this.queue.getRepeatableJobs();
    const already = existing.find((job) => job.name === SCORE_JOB_NAME);
    if (already) {
      this.logger.log(`Listing score job already scheduled (${already.pattern})`);
      return;
    }

    const cron = this.config.get<string>('LISTING_SCORE_CRON') ?? '30 2 * * *';
    await this.queue.add(
      SCORE_JOB_NAME,
      { scheduledAt: new Date().toISOString() },
      {
        repeat: { pattern: cron },
        attempts: 2,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 20,
        removeOnFail: 20
      }
    );
    this.logger.log(`Listing score scheduled with cron '${cron}'`);
  }

  async process(job: Job) {
    if (job.name !== SCORE_JOB_NAME && job.name !== 'run-once') return;
    try {
      const qualified = await this.scorer.scoreAll();
      this.logger.log(`Scored candidates, ${qualified.length} qualified`);

      for (const result of qualified) {
        const candidate = await this.candidateRepo.findOne({ where: { coinId: result.coinId } });
        if (!candidate) continue;
        await this.tracker.handleQualifiedCandidate(candidate);
      }

      return { qualified: qualified.length };
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.error(`Listing score job failed: ${err.message}`, err.stack);
      throw error;
    }
  }

  /** Admin endpoint hook to force an immediate scoring run. */
  async runNow(): Promise<void> {
    await this.queue.add('run-once', { scheduledAt: new Date().toISOString() });
  }
}
