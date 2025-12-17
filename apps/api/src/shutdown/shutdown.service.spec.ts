import { Logger } from '@nestjs/common';

import { Queue } from 'bullmq';

import { QUEUE_NAMES } from './queue-names.constant';
import { ShutdownService } from './shutdown.service';

type QueueMock = Pick<Queue, 'pause' | 'getActiveCount'>;

const createQueueMocks = (overrides?: Partial<Record<(typeof QUEUE_NAMES)[number], Partial<QueueMock>>>) => {
  const queues: Record<string, QueueMock> = {};

  for (const name of QUEUE_NAMES) {
    queues[name] = {
      pause: jest.fn().mockResolvedValue(undefined),
      getActiveCount: jest.fn().mockResolvedValue(0),
      ...(overrides?.[name] ?? {})
    } as QueueMock;
  }

  const service = new ShutdownService(
    ...(QUEUE_NAMES.map((name) => queues[name]) as unknown as ConstructorParameters<typeof ShutdownService>)
  );

  return { queues, service };
};

describe('ShutdownService', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('pauses queues and waits for active jobs on shutdown', async () => {
    const { queues, service } = createQueueMocks();
    const logSpy = jest.spyOn(service['logger'] as Logger, 'log');

    await service.onApplicationShutdown('SIGTERM');

    for (const name of QUEUE_NAMES) {
      expect(queues[name].pause).toHaveBeenCalled();
      expect(queues[name].getActiveCount).toHaveBeenCalled();
    }
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Shutdown signal received: SIGTERM'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Graceful shutdown complete'));
  });

  it('logs progress while waiting for active jobs to finish', async () => {
    const { service } = createQueueMocks({
      'order-queue': {
        getActiveCount: jest.fn().mockResolvedValueOnce(2).mockResolvedValue(0)
      }
    });
    const logSpy = jest.spyOn(service['logger'] as Logger, 'log');
    jest.useFakeTimers();

    const waitPromise = (service as any).waitForActiveJobs();

    await jest.advanceTimersByTimeAsync(1000);
    await waitPromise;

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Waiting for 2 active job(s): order-queue: 2'));
    expect(logSpy).toHaveBeenCalledWith('All active jobs completed.');
  });

  it('warns when timeout is reached with remaining jobs', async () => {
    const { service } = createQueueMocks({
      'order-queue': {
        getActiveCount: jest.fn().mockResolvedValue(1)
      }
    });
    const warnSpy = jest.spyOn(service['logger'] as Logger, 'warn');
    jest.useFakeTimers();

    (service as any).JOB_DRAIN_TIMEOUT = 2000;
    (service as any).POLL_INTERVAL = 500;

    const waitPromise = (service as any).waitForActiveJobs();

    await jest.advanceTimersByTimeAsync(2000);
    await waitPromise;

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Shutdown timeout reached. Remaining active jobs:'));
  });

  it('continues when pausing a queue fails', async () => {
    const { queues, service } = createQueueMocks({
      'price-queue': {
        pause: jest.fn().mockRejectedValue(new Error('pause failure'))
      }
    });
    const warnSpy = jest.spyOn(service['logger'] as Logger, 'warn');

    await (service as any).pauseAllQueues();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to pause queue price-queue: pause failure'));
    for (const name of QUEUE_NAMES) {
      expect(queues[name].pause).toHaveBeenCalled();
    }
  });

  it('returns zero for queues that fail to report active count', async () => {
    const { service } = createQueueMocks({
      'user-queue': {
        getActiveCount: jest.fn().mockRejectedValue(new Error('count failure'))
      }
    });
    const warnSpy = jest.spyOn(service['logger'] as Logger, 'warn');

    const counts = await (service as any).getActiveJobCounts();

    expect(counts['user-queue']).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to get active count for user-queue: count failure')
    );
  });
});
