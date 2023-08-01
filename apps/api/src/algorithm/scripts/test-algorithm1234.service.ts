import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { Algorithm } from './../algorithm.entity';
import { AlgorithmService } from '../algorithm.service';
@Injectable()
export class TestAlgorithm123Service {
  readonly id = '8b55653d-0cba-40d2-bde0-be90fa395854';
  private readonly logger = new Logger(TestAlgorithm123Service.name);
  constructor(private readonly algorithm: AlgorithmService, private readonly schedulerRegistry: SchedulerRegistry) {}

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
