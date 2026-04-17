import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';

import { Job, Queue } from 'bullmq';
import { Repository } from 'typeorm';

import { Coin } from '../../coin/coin.entity';
import { FailSafeWorkerHost } from '../../failed-jobs/fail-safe-worker-host';
import { FailedJobService } from '../../failed-jobs/failed-job.service';
import { toErrorInfo } from '../../shared/error.util';
import { ListingAnnouncement } from '../entities/listing-announcement.entity';
import { AnnouncementPollerService } from '../services/announcement-poller.service';
import { ListingTrackerService } from '../services/listing-tracker.service';

export const LISTING_ANNOUNCEMENT_POLL_QUEUE = 'listing-announcement-poll';
const POLL_JOB_NAME = 'listing-announcement-poll';

@Processor(LISTING_ANNOUNCEMENT_POLL_QUEUE)
@Injectable()
export class AnnouncementPollTask extends FailSafeWorkerHost implements OnModuleInit {
  private readonly logger = new Logger(AnnouncementPollTask.name);
  private jobScheduled = false;

  constructor(
    @InjectQueue(LISTING_ANNOUNCEMENT_POLL_QUEUE) private readonly queue: Queue,
    @InjectRepository(Coin) private readonly coinRepo: Repository<Coin>,
    private readonly poller: AnnouncementPollerService,
    private readonly tracker: ListingTrackerService,
    private readonly config: ConfigService,
    failedJobService: FailedJobService
  ) {
    super(failedJobService);
  }

  async onModuleInit() {
    if (this.isDisabled()) {
      this.logger.log('Listing announcement polling disabled');
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
    const alreadyScheduled = existing.find((job) => job.name === POLL_JOB_NAME);
    if (alreadyScheduled) {
      this.logger.log(`Announcement poll job already scheduled (every ${alreadyScheduled.every}ms)`);
      return;
    }

    const rawInterval = this.config.get<string>('LISTING_TRACKER_POLL_INTERVAL_SECONDS');
    const parsed = rawInterval ? parseInt(rawInterval, 10) : 30;
    const intervalSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
    const intervalMs = Math.max(10, intervalSeconds) * 1000;

    await this.queue.add(
      POLL_JOB_NAME,
      { scheduledAt: new Date().toISOString() },
      {
        repeat: { every: intervalMs },
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 50,
        removeOnFail: 30
      }
    );
    this.logger.log(`Announcement poll scheduled every ${intervalSeconds}s`);
  }

  async process(job: Job) {
    if (job.name !== POLL_JOB_NAME) return;
    try {
      const results = await this.poller.pollAll();
      const totalInserted = results.reduce((sum, r) => sum + r.inserted.length, 0);
      if (totalInserted === 0) return { totalInserted: 0 };

      for (const result of results) {
        for (const announcement of result.inserted) {
          await this.dispatchAnnouncement(announcement);
        }
      }

      return {
        totalInserted,
        perExchange: results.map((r) => ({ exchange: r.exchangeSlug, count: r.inserted.length }))
      };
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.error(`Announcement poll failed: ${err.message}`, err.stack);
      throw error;
    }
  }

  private async dispatchAnnouncement(announcement: ListingAnnouncement): Promise<void> {
    if (!announcement.coinId) {
      this.logger.debug(
        `Skipping announcement ${announcement.id}: no matching coin for ${announcement.announcedSymbol}`
      );
      return;
    }
    const coin = await this.coinRepo.findOne({ where: { id: announcement.coinId } });
    if (!coin) return;
    await this.tracker.handleNewAnnouncement(announcement, coin);
  }
}
