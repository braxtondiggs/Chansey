import 'reflect-metadata';

import { Processor } from '@nestjs/bullmq';

import { type Job } from 'bullmq';

import { FailSafeWorkerHost } from './fail-safe-worker-host';
import { type FailedJobService } from './failed-job.service';

@Processor('test-queue')
class TestWorker extends FailSafeWorkerHost {
  async process(): Promise<void> {
    /* no-op */
  }
}

describe('FailSafeWorkerHost', () => {
  let recordFailure: jest.Mock;
  let worker: TestWorker;

  beforeEach(() => {
    recordFailure = jest.fn().mockResolvedValue(undefined);
    worker = new TestWorker({ recordFailure } as unknown as FailedJobService);
  });

  const makeJob = (overrides: Partial<Job> = {}): Job =>
    ({
      id: 'j1',
      name: 'process',
      data: { x: 1 },
      attemptsMade: 3,
      opts: { attempts: 3 },
      ...overrides
    }) as unknown as Job;

  it('records terminal failure with full payload', async () => {
    const error = new Error('boom');
    error.stack = 'stack-trace';

    await worker.onFailed(makeJob(), error);

    expect(recordFailure).toHaveBeenCalledTimes(1);
    expect(recordFailure).toHaveBeenCalledWith({
      queueName: 'test-queue',
      jobId: 'j1',
      jobName: 'process',
      jobData: { x: 1 },
      errorMessage: 'boom',
      stackTrace: 'stack-trace',
      attemptsMade: 3,
      maxAttempts: 3
    });
  });

  it('skips interim retries (attemptsMade < maxAttempts)', async () => {
    await worker.onFailed(makeJob({ attemptsMade: 1, opts: { attempts: 3 } }), new Error('transient'));
    await worker.onFailed(makeJob({ attemptsMade: 2, opts: { attempts: 3 } }), new Error('transient'));

    expect(recordFailure).not.toHaveBeenCalled();
  });

  it('falls back jobId to "unknown" when undefined', async () => {
    await worker.onFailed(makeJob({ id: undefined }), new Error('boom'));

    expect(recordFailure).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'unknown' }));
  });

  it('logs and swallows when recordFailure throws (outer fail-safe)', async () => {
    recordFailure.mockRejectedValueOnce(new Error('db down'));

    await expect(worker.onFailed(makeJob(), new Error('boom'))).resolves.toBeUndefined();

    expect(recordFailure).toHaveBeenCalledTimes(1);
  });

  it('treats missing maxAttempts opts as 1 (records single-attempt failure)', async () => {
    await worker.onFailed(makeJob({ attemptsMade: 1, opts: undefined }), new Error('boom'));

    expect(recordFailure).toHaveBeenCalledTimes(1);
    expect(recordFailure).toHaveBeenCalledWith(expect.objectContaining({ maxAttempts: 1 }));
  });
});
