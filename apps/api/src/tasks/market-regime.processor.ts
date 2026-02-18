import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';

import { Job } from 'bullmq';

import { MarketRegimeTask } from './market-regime.task';

import { CompositeRegimeService } from '../market-regime/composite-regime.service';
import { toErrorInfo } from '../shared/error.util';

@Injectable()
@Processor('regime-check-queue')
export class MarketRegimeProcessor extends WorkerHost {
  private readonly logger = new Logger(MarketRegimeProcessor.name);

  constructor(
    private readonly marketRegimeTask: MarketRegimeTask,
    private readonly compositeRegimeService: CompositeRegimeService
  ) {
    super();
  }

  async process(job: Job<{ asset: string; timestamp: string }>): Promise<void> {
    const { asset } = job.data;

    this.logger.log(`Processing regime check job ${job.id} for ${asset}`);

    const startTime = Date.now();

    try {
      await this.marketRegimeTask.processRegimeCheck(asset);

      // Refresh composite regime after volatility data is persisted
      try {
        const composite = await this.compositeRegimeService.refresh();
        this.logger.log(`Composite regime refreshed after ${asset}: ${composite}`);
      } catch (refreshError: unknown) {
        const refreshErr = toErrorInfo(refreshError);
        this.logger.warn(`Composite regime refresh failed after ${asset}: ${refreshErr.message}`);
      }

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
