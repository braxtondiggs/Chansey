import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { CronJob } from 'cron';

/**
 * Task Scheduler Service
 *
 * Manages all scheduled background tasks with dynamic cron expressions
 */
@Injectable()
export class TaskSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(TaskSchedulerService.name);

  constructor(private schedulerRegistry: SchedulerRegistry) {}

  onModuleInit() {
    this.logger.log('Task Scheduler initialized');
    this.logScheduledJobs();
  }

  /**
   * Add a dynamic cron job
   */
  addCronJob(name: string, cronExpression: string, callback: () => void) {
    const job = new CronJob(cronExpression, callback);
    this.schedulerRegistry.addCronJob(name, job);
    job.start();

    this.logger.log(`Cron job '${name}' added with expression: ${cronExpression}`);
  }

  /**
   * Remove a cron job
   */
  removeCronJob(name: string) {
    this.schedulerRegistry.deleteCronJob(name);
    this.logger.log(`Cron job '${name}' removed`);
  }

  /**
   * Get all scheduled jobs
   */
  getCronJobs(): Map<string, CronJob> {
    return this.schedulerRegistry.getCronJobs();
  }

  /**
   * Log all scheduled jobs
   */
  logScheduledJobs() {
    const jobs = this.getCronJobs();
    this.logger.log(`Total scheduled jobs: ${jobs.size}`);

    jobs.forEach((job, name) => {
      try {
        const next = job.nextDate().toJSDate();
        this.logger.log(`Job: ${name}, Next run: ${next}`);
      } catch (e) {
        this.logger.log(`Job: ${name}, Next run: N/A`);
      }
    });
  }

  /**
   * Update cron job schedule
   * Note: This is a simplified version - full implementation would need to store the original callback
   */
  updateCronJobSchedule(name: string, newCronExpression: string) {
    this.logger.warn(`Cron job schedule update for '${name}' not fully implemented - requires job recreation`);
    // TODO: Implement job recreation with new schedule
    // Would require storing original callbacks or using NestJS @Cron decorators exclusively
  }

  /**
   * Pause a cron job
   */
  pauseCronJob(name: string) {
    const job = this.schedulerRegistry.getCronJob(name);
    job.stop();
    this.logger.log(`Cron job '${name}' paused`);
  }

  /**
   * Resume a cron job
   */
  resumeCronJob(name: string) {
    const job = this.schedulerRegistry.getCronJob(name);
    job.start();
    this.logger.log(`Cron job '${name}' resumed`);
  }

  /**
   * Get job status
   */
  getJobStatus(name: string): { name: string; running: boolean; nextRun?: Date } {
    try {
      const job = this.schedulerRegistry.getCronJob(name);
      // Note: CronJob doesn't expose running status directly
      // We use the existence of nextDate as a proxy for "running"
      const nextDate = job.nextDate();
      return {
        name,
        running: !!nextDate, // If it has a next date, it's scheduled/running
        nextRun: nextDate?.toJSDate()
      };
    } catch (error) {
      throw new Error(`Job '${name}' not found`);
    }
  }

  /**
   * Get all job statuses
   */
  getAllJobStatuses(): Array<{ name: string; running: boolean; nextRun?: Date }> {
    const jobs = this.getCronJobs();
    const statuses: Array<{ name: string; running: boolean; nextRun?: Date }> = [];

    jobs.forEach((job, name) => {
      const nextDate = job.nextDate();
      statuses.push({
        name,
        running: !!nextDate,
        nextRun: nextDate?.toJSDate()
      });
    });

    return statuses;
  }

  /**
   * Predefined cron expressions for common schedules
   */
  readonly SCHEDULES = {
    EVERY_MINUTE: '* * * * *',
    EVERY_5_MINUTES: '*/5 * * * *',
    EVERY_15_MINUTES: '*/15 * * * *',
    EVERY_30_MINUTES: '*/30 * * * *',
    EVERY_HOUR: '0 * * * *',
    EVERY_6_HOURS: '0 */6 * * *',
    EVERY_12_HOURS: '0 */12 * * *',
    DAILY_AT_MIDNIGHT: '0 0 * * *',
    DAILY_AT_NOON: '0 12 * * *',
    WEEKLY_MONDAY_MORNING: '0 9 * * 1',
    MONTHLY_FIRST_DAY: '0 0 1 * *'
  };
}
