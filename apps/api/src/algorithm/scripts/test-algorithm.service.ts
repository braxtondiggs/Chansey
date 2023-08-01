import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { Algorithm } from './../algorithm.entity';
import { AlgorithmService } from '../algorithm.service';

@Injectable()
export class TestAlgorithmService {
  readonly id = '100c1721-7b0b-4d96-a18e-40904c0cc36b';
  private readonly logger = new Logger(TestAlgorithmService.name);
  constructor(private readonly algorithm: AlgorithmService, private schedulerRegistry: SchedulerRegistry) {}

  async onInit(algorithm: Algorithm) {
    this.logger.log(`${algorithm.name}: Running Successfully!`);
    this.addCronJob(algorithm.name, '30');
  }

  private addCronJob(name: string, seconds: string) {
    const job = new CronJob(`${seconds} * * * * *`, this.cronJob.bind(this), null, true, 'America/New_York');

    this.schedulerRegistry.addCronJob(name, job);
    job.start();

    setTimeout(() => {
      job.stop();
      this.schedulerRegistry.deleteCronJob(name);
    }, 100000);
  }

  private async cronJob() {
    this.logger.log('Hello World');
  }
}
