import { Test } from '@nestjs/testing';

import { type Job } from 'bullmq';

import { PipelineNotificationDigestProcessor } from './pipeline-notification-digest.processor';

import { FailedJobService } from '../../failed-jobs/failed-job.service';
import { type FlushJobData, PipelineNotificationDigestService } from '../services/pipeline-notification-digest.service';

describe('PipelineNotificationDigestProcessor', () => {
  let processor: PipelineNotificationDigestProcessor;
  let digestService: { flush: jest.Mock };

  beforeEach(async () => {
    digestService = { flush: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        PipelineNotificationDigestProcessor,
        { provide: PipelineNotificationDigestService, useValue: digestService },
        { provide: FailedJobService, useValue: { recordFailure: jest.fn() } }
      ]
    }).compile();

    processor = module.get(PipelineNotificationDigestProcessor);
  });

  it('delegates to digest.flush with userId + bucket', async () => {
    const job = { id: 'job-1', data: { userId: 'user-9', bucket: 'started' } } as Job<FlushJobData>;
    await processor.process(job);

    expect(digestService.flush).toHaveBeenCalledTimes(1);
    expect(digestService.flush).toHaveBeenCalledWith('user-9', 'started');
  });
});
