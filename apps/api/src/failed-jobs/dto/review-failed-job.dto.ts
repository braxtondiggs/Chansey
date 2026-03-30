import { IsIn, IsOptional, IsString } from 'class-validator';

import { FailedJobStatus } from '../entities/failed-job-log.entity';

export class ReviewFailedJobDto {
  @IsIn([FailedJobStatus.REVIEWED, FailedJobStatus.DISMISSED], { message: 'status must be reviewed or dismissed' })
  status: FailedJobStatus.REVIEWED | FailedJobStatus.DISMISSED;

  @IsOptional()
  @IsString()
  adminNotes?: string;
}
