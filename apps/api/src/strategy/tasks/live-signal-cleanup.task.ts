import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';

import { LessThan, Repository } from 'typeorm';

import { toErrorInfo } from '../../shared/error.util';
import { LiveTradingSignal } from '../entities/live-trading-signal.entity';

const RETENTION_DAYS = 90;

@Injectable()
export class LiveSignalCleanupTask {
  private readonly logger = new Logger(LiveSignalCleanupTask.name);

  constructor(
    @InjectRepository(LiveTradingSignal)
    private readonly repo: Repository<LiveTradingSignal>
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanupOldRecords(): Promise<void> {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

      const result = await this.repo.delete({
        createdAt: LessThan(cutoff)
      });

      if (result.affected && result.affected > 0) {
        this.logger.log(`Cleaned up ${result.affected} live signal record(s) older than ${RETENTION_DAYS} days`);
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Live signal cleanup error (fail-safe): ${err.message}`, err.stack);
    }
  }
}
