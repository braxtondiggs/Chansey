import { Processor } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { Job } from 'bullmq';

import { FailSafeWorkerHost } from '../../failed-jobs/fail-safe-worker-host';
import { FailedJobService } from '../../failed-jobs/failed-job.service';
import { toErrorInfo } from '../../shared/error.util';
import { OHLCBackfillService } from '../services/ohlc-backfill.service';

interface OHLCBackfillJobData {
  coinId: string;
  symbol: string;
  startDate: string; // ISO
  endDate: string; // ISO
}

@Processor('ohlc-backfill-queue')
@Injectable()
export class OHLCBackfillJobTask extends FailSafeWorkerHost implements OnModuleInit {
  private readonly logger = new Logger(OHLCBackfillJobTask.name);

  constructor(
    private readonly backfillService: OHLCBackfillService,
    failedJobService: FailedJobService
  ) {
    super(failedJobService);
  }

  // Bound exchange-side concurrency: at most 2 backfills run cluster-wide at any time.
  // Set in onModuleInit because the @nestjs/bullmq @Processor decorator's options form
  // is not universally honored across versions — assigning to `worker.concurrency` is
  // the established pattern in this codebase.
  onModuleInit(): void {
    this.worker.concurrency = 2;
    this.logger.log(`OHLC backfill worker concurrency set to ${this.worker.concurrency}`);
  }

  async process(job: Job<OHLCBackfillJobData>) {
    const { coinId, symbol, startDate, endDate } = job.data;
    this.logger.log(`Processing backfill job ${job.id} for coin ${coinId}`);
    try {
      await this.backfillService.runBackfill(coinId, symbol, new Date(startDate), new Date(endDate));
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Backfill job ${job.id} failed for coin ${coinId}: ${err.message}`, err.stack);
      throw error;
    }
  }
}
