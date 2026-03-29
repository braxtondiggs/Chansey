import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';

import { In, LessThan, Repository } from 'typeorm';

import { FailedJobLog, FailedJobStatus } from './entities/failed-job-log.entity';

import { toErrorInfo } from '../shared/error.util';

const RETENTION_DAYS = 90;
const STALE_RETENTION_DAYS = 180;

@Injectable()
export class FailedJobCleanupTask {
  private readonly logger = new Logger(FailedJobCleanupTask.name);

  constructor(
    @InjectRepository(FailedJobLog)
    private readonly repo: Repository<FailedJobLog>
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupOldRecords(): Promise<void> {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

      const result = await this.repo.delete({
        status: In([FailedJobStatus.REVIEWED, FailedJobStatus.DISMISSED]),
        createdAt: LessThan(cutoff)
      });

      if (result.affected && result.affected > 0) {
        this.logger.log(`Cleaned up ${result.affected} failed job log(s) older than ${RETENTION_DAYS} days`);
      }

      // Clean up stale PENDING/RETRIED entries that were never addressed
      const staleCutoff = new Date();
      staleCutoff.setDate(staleCutoff.getDate() - STALE_RETENTION_DAYS);
      const staleResult = await this.repo.delete({
        status: In([FailedJobStatus.PENDING, FailedJobStatus.RETRIED]),
        createdAt: LessThan(staleCutoff)
      });

      if (staleResult.affected && staleResult.affected > 0) {
        this.logger.log(
          `Cleaned up ${staleResult.affected} stale pending/retried job log(s) older than ${STALE_RETENTION_DAYS} days`
        );
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed job cleanup error (fail-safe): ${err.message}`, err.stack);
    }
  }
}
