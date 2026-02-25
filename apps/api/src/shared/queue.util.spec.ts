import { Logger } from '@nestjs/common';

import { forceRemoveJob } from './queue.util';

describe('forceRemoveJob', () => {
  let queue: Record<string, any>;
  let redisClient: Record<string, jest.Mock>;
  let logger: Logger;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    redisClient = { set: jest.fn().mockResolvedValue('OK') };

    queue = {
      getJob: jest.fn().mockResolvedValue(null),
      client: Promise.resolve(redisClient),
      opts: { prefix: 'bull' },
      name: 'test-queue'
    };

    logger = new Logger('TestQueueUtil');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is a no-op when the job does not exist', async () => {
    queue.getJob.mockResolvedValue(null);

    await forceRemoveJob(queue as any, 'job-1', logger);

    expect(queue.getJob).toHaveBeenCalledWith('job-1');
  });

  it('removes the job normally when remove() succeeds', async () => {
    const mockJob = { remove: jest.fn().mockResolvedValue(undefined) };
    queue.getJob.mockResolvedValue(mockJob);

    await forceRemoveJob(queue as any, 'job-1', logger);

    expect(mockJob.remove).toHaveBeenCalledTimes(1);
  });

  it('force-removes via moveToFailed when initial remove() fails', async () => {
    const mockJob = {
      remove: jest.fn().mockRejectedValueOnce(new Error('Job is locked')).mockResolvedValueOnce(undefined),
      moveToFailed: jest.fn().mockResolvedValue(undefined)
    };
    queue.getJob.mockResolvedValue(mockJob);

    await forceRemoveJob(queue as any, 'job-1', logger);

    // Should set recovery lock token
    expect(redisClient.set).toHaveBeenCalledWith('bull:test-queue:job-1:lock', expect.stringMatching(/^recovery-\d+$/));

    // Should move to failed with recovery token
    expect(mockJob.moveToFailed).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Orphaned after deployment' }),
      expect.stringMatching(/^recovery-\d+$/),
      false
    );

    // Should remove after moveToFailed (2 total calls: initial fail + post-moveToFailed success)
    expect(mockJob.remove).toHaveBeenCalledTimes(2);
  });

  it('handles graceful failure when both remove and moveToFailed fail', async () => {
    const mockJob = {
      remove: jest.fn().mockRejectedValue(new Error('locked')),
      moveToFailed: jest.fn().mockRejectedValue(new Error('move failed'))
    };
    queue.getJob.mockResolvedValue(mockJob);

    // Should not throw
    await expect(forceRemoveJob(queue as any, 'job-1', logger)).resolves.toBeUndefined();
  });

  it('uses default logger when none provided', async () => {
    queue.getJob.mockResolvedValue(null);

    // Should not throw when no logger is provided
    await expect(forceRemoveJob(queue as any, 'job-1')).resolves.toBeUndefined();
  });

  it('uses correct prefix from queue opts', async () => {
    queue.opts = { prefix: 'custom-prefix' };
    const mockJob = {
      remove: jest.fn().mockRejectedValueOnce(new Error('locked')).mockResolvedValueOnce(undefined),
      moveToFailed: jest.fn().mockResolvedValue(undefined)
    };
    queue.getJob.mockResolvedValue(mockJob);

    await forceRemoveJob(queue as any, 'job-1', logger);

    expect(redisClient.set).toHaveBeenCalledWith(
      'custom-prefix:test-queue:job-1:lock',
      expect.stringMatching(/^recovery-\d+$/)
    );
  });

  it('falls back to "bull" prefix when queue.opts.prefix is undefined', async () => {
    queue.opts = {};
    const mockJob = {
      remove: jest.fn().mockRejectedValueOnce(new Error('locked')).mockResolvedValueOnce(undefined),
      moveToFailed: jest.fn().mockResolvedValue(undefined)
    };
    queue.getJob.mockResolvedValue(mockJob);

    await forceRemoveJob(queue as any, 'job-1', logger);

    expect(redisClient.set).toHaveBeenCalledWith('bull:test-queue:job-1:lock', expect.stringMatching(/^recovery-\d+$/));
  });
});
