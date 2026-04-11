import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FailedJobLog } from './entities/failed-job-log.entity';
import { FailedJobAlertService } from './failed-job-alert.service';
import { FailedJobCleanupTask } from './failed-job-cleanup.task';
import { FailedJobController } from './failed-job.controller';
import { FailedJobService } from './failed-job.service';

import { AuditModule } from '../audit/audit.module';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([FailedJobLog]), AuditModule],
  providers: [FailedJobService, FailedJobAlertService, FailedJobCleanupTask],
  controllers: [FailedJobController],
  exports: [FailedJobService]
})
export class FailedJobModule {}
