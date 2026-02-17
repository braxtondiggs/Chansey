import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';

import { Job } from 'bullmq';

import { MarketRegimeTask } from './market-regime.task';

import { toErrorInfo } from '../shared/error.util';

@Injectable()
@Processor('regime-check-queue')
export class MarketRegimeProcessor extends WorkerHost {
  private readonly logger = new Logger(MarketRegimeProcessor.name);

  constructor(private readonly marketRegimeTask: MarketRegimeTask) {
    super();
  }

  async process(job: Job<{ asset: string; timestamp: string }>): Promise<void> {
    const { asset } = job.data;

    this.logger.log(`Processing regime check job ${job.id} for ${asset}`);

    const startTime = Date.now();

    try {
      await this.marketRegimeTask.processRegimeCheck(asset);

      const duration = Date.now() - startTime;
      this.logger.log(`Regime check job ${job.id} completed for ${asset} in ${duration}ms`);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      const duration = Date.now() - startTime;
      this.logger.error(
        `Regime check job ${job.id} failed for ${asset} after ${duration}ms: ${err.message}`,
        err.stack
      );
      throw error;
    }
  }
}
