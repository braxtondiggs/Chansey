import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { Job, Queue } from 'bullmq';

import { Risk } from '../../risk/risk.entity';
import { RiskService } from '../../risk/risk.service';
import { toErrorInfo } from '../../shared/error.util';
import { UsersService } from '../users.service';

interface SelectionUpdateJobData {
  riskLevel: number;
  timestamp: string;
  description: string;
}

@Processor('user-queue')
@Injectable()
export class UsersTaskService extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(UsersTaskService.name);
  private jobsScheduled = false;

  constructor(
    @InjectQueue('user-queue') private readonly userQueue: Queue,
    private readonly user: UsersService,
    private readonly riskService: RiskService
  ) {
    super();
  }

  async onModuleInit() {
    // Skip scheduling jobs in local development
    if (process.env.NODE_ENV === 'development' || process.env.DISABLE_BACKGROUND_TASKS === 'true') {
      this.logger.log('User sync jobs disabled for local development');
      return;
    }

    if (!this.jobsScheduled) {
      await this.scheduleSelectionUpdateJobs();
      this.jobsScheduled = true;
    }
  }

  /**
   * Schedule coin selection update jobs for each risk level based on their cron patterns
   */
  private async scheduleSelectionUpdateJobs() {
    const risks = await this.riskService.findAll();
    const repeatedJobs = await this.userQueue.getRepeatableJobs();

    for (const risk of risks) {
      if (risk.selectionUpdateCron) {
        await this.scheduleSelectionUpdateForRisk(risk, repeatedJobs);
      } else {
        this.logger.debug(`Risk level ${risk.level} (${risk.name}) has no selection update cron - skipping`);
      }
    }
  }

  private async scheduleSelectionUpdateForRisk(
    risk: Risk,
    existingJobs: Awaited<ReturnType<Queue['getRepeatableJobs']>>
  ) {
    const jobName = `selection-update-risk-${risk.level}`;
    const existingJob = existingJobs.find((job) => job.name === jobName);

    // If job exists with same pattern, skip
    if (existingJob && existingJob.pattern === risk.selectionUpdateCron) {
      this.logger.log(`Selection update job for risk ${risk.level} already scheduled: ${existingJob.pattern}`);
      return;
    }

    // If job exists with different pattern, remove it first
    if (existingJob && existingJob.pattern !== risk.selectionUpdateCron) {
      await this.userQueue.removeRepeatableByKey(existingJob.key);
      this.logger.log(`Removed outdated selection update job for risk ${risk.level} (was: ${existingJob.pattern})`);
    }

    // Schedule new job
    await this.userQueue.add(
      jobName,
      {
        riskLevel: risk.level,
        timestamp: new Date().toISOString(),
        description: `Scheduled coin selection update for risk level ${risk.level} (${risk.name})`
      } satisfies SelectionUpdateJobData,
      {
        repeat: { pattern: risk.selectionUpdateCron as string },
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 100,
        removeOnFail: 50
      }
    );
    this.logger.log(
      `Selection update job scheduled for risk ${risk.level} (${risk.name}): ${risk.selectionUpdateCron}`
    );
  }

  async process(job: Job<SelectionUpdateJobData>) {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);
    try {
      if (job.name.startsWith('selection-update-risk-')) {
        const result = await this.updateUserCoinSelectionByRiskLevel(job);
        this.logger.log(`Job ${job.id} completed with result: ${JSON.stringify(result)}`);
        return result;
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to process job ${job.id}: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Update coin selections for users with a specific risk level
   */
  private async updateUserCoinSelectionByRiskLevel(job: Job<SelectionUpdateJobData>) {
    const { riskLevel } = job.data;
    this.logger.log(`Starting Coin Selection Update for risk level ${riskLevel}`);
    await job.updateProgress(10);

    const users = await this.user.getUsersByRiskLevel(riskLevel);
    await job.updateProgress(30);

    let updated = 0;
    const total = users.length;

    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      if (user.coinRisk) {
        await this.user.updateCoinSelectionByUserRisk(user);
        updated++;
        this.logger.debug(`Updated coin selection for user: ${user.id} (risk level ${riskLevel})`);
      }
      // Update progress between 30-100 based on user progress
      await job.updateProgress(30 + Math.floor((70 * (i + 1)) / total));
    }

    await job.updateProgress(100);
    return { updated, total, riskLevel };
  }
}
