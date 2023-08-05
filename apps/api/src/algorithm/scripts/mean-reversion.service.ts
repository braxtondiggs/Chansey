import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { PriceSummaryByDay } from '../../price/price.entity';
import { Algorithm } from '../algorithm.entity';
import { AlgorithmService } from '../algorithm.service';

@Injectable()
export class MeanReversionService {
  readonly id = 'f206b716-6be3-499f-8186-2581e9755a98';
  private lastFetch: Date;
  private algorithm: Algorithm;
  private prices: PriceSummaryByDay;
  private readonly logger = new Logger(MeanReversionService.name);
  constructor(
    private readonly algorithmService: AlgorithmService,
    private readonly schedulerRegistry: SchedulerRegistry
  ) {}

  async onInit(algorithm: Algorithm) {
    this.logger.log(`${algorithm.name}: Running Successfully!`);
    this.algorithm = algorithm;
    this.addCronJob();
  }

  private addCronJob() {
    const job = new CronJob(this.algorithm.cron, this.cronJob.bind(this), null, true, 'America/New_York');

    this.schedulerRegistry.addCronJob(`${this.algorithm.name} Service`, job);
    job.start();
    this.cronJob();
  }

  private async cronJob() {
    this.logger.log('Hello World');
  }
}
