import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';

import { Job, Queue } from 'bullmq';
import { LessThan, Repository } from 'typeorm';

import { FailSafeWorkerHost } from '../../failed-jobs/fail-safe-worker-host';
import { FailedJobService } from '../../failed-jobs/failed-job.service';
import { Order } from '../../order/order.entity';
import { toErrorInfo } from '../../shared/error.util';
import { User } from '../../users/users.entity';
import { ListingPositionStatus, ListingTradePosition } from '../entities/listing-trade-position.entity';
import { ListingHedgeService } from '../services/listing-hedge.service';
import { ListingTradeExecutorService } from '../services/listing-trade-executor.service';

export const LISTING_TIME_STOP_QUEUE = 'listing-time-stop';
const TIME_STOP_JOB_NAME = 'listing-time-stop-sweep';

@Processor(LISTING_TIME_STOP_QUEUE)
@Injectable()
export class ListingTimeStopTask extends FailSafeWorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ListingTimeStopTask.name);
  private jobScheduled = false;

  constructor(
    @InjectQueue(LISTING_TIME_STOP_QUEUE) private readonly queue: Queue,
    @InjectRepository(ListingTradePosition)
    private readonly positionRepo: Repository<ListingTradePosition>,
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly executor: ListingTradeExecutorService,
    private readonly hedgeService: ListingHedgeService,
    private readonly config: ConfigService,
    failedJobService: FailedJobService
  ) {
    super(failedJobService);
  }

  async onModuleInit() {
    if (this.isDisabled()) {
      this.logger.log('Listing time-stop task disabled');
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
    const already = existing.find((job) => job.name === TIME_STOP_JOB_NAME);
    if (already) {
      this.logger.log(`Listing time-stop already scheduled (${already.pattern})`);
      return;
    }
    await this.queue.add(
      TIME_STOP_JOB_NAME,
      { scheduledAt: new Date().toISOString() },
      {
        repeat: { pattern: CronExpression.EVERY_HOUR },
        attempts: 2,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 50,
        removeOnFail: 30
      }
    );
    this.logger.log('Listing time-stop scheduled hourly');
  }

  async process(job: Job) {
    if (job.name !== TIME_STOP_JOB_NAME) return;

    try {
      const now = new Date();
      const expired = await this.positionRepo.find({
        where: { status: ListingPositionStatus.OPEN, expiresAt: LessThan(now) },
        relations: ['hedgeOrder']
      });

      if (expired.length === 0) return { closed: 0 };

      let closed = 0;
      for (const position of expired) {
        const result = await this.executor.closePosition({
          position,
          nextStatus: ListingPositionStatus.EXITED_TIME_STOP,
          reason: 'time_stop'
        });
        if (result) {
          closed++;
          await this.closeHedgeIfPresent(position);
        }
      }
      this.logger.log(`Listing time-stop swept ${expired.length} positions, closed ${closed}`);
      return { closed };
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.error(`Listing time-stop failed: ${err.message}`, err.stack);
      throw error;
    }
  }

  private async closeHedgeIfPresent(position: ListingTradePosition): Promise<void> {
    if (!position.hedgeOrderId) return;
    const hedgeOrder = position.hedgeOrder ?? (await this.orderRepo.findOne({ where: { id: position.hedgeOrderId } }));
    if (!hedgeOrder) return;
    const user = await this.userRepo.findOne({ where: { id: position.userId } });
    if (!user) return;
    await this.hedgeService.closeShort(user, hedgeOrder);
  }
}
