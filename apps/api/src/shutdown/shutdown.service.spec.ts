import { type Logger } from '@nestjs/common';

import { type Queue } from 'bullmq';

import { QUEUE_NAMES } from './queue-names.constant';
import { ShutdownService } from './shutdown.service';

type QueueMock = Pick<Queue, 'pause' | 'getActiveCount' | 'isPaused' | 'resume'>;

const createQueueMocks = (overrides?: Partial<Record<(typeof QUEUE_NAMES)[number], Partial<QueueMock>>>) => {
  const queues: Record<string, QueueMock> = {};

  for (const name of QUEUE_NAMES) {
    queues[name] = {
      pause: jest.fn().mockResolvedValue(undefined),
      getActiveCount: jest.fn().mockResolvedValue(0),
      isPaused: jest.fn().mockResolvedValue(false),
      resume: jest.fn().mockResolvedValue(undefined),
      ...(overrides?.[name] ?? {})
    } as QueueMock;
  }

  const shutdownSignal = { trigger: jest.fn(), signal: new AbortController().signal, isShuttingDown: false };

  const args = [shutdownSignal, ...QUEUE_NAMES.map((name) => queues[name])] as unknown as ConstructorParameters<
    typeof ShutdownService
  >;
  const service = new ShutdownService(...args);

  return { queues, service, shutdownSignal };
};

describe('ShutdownService', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('triggers shutdown signal, pauses all queues, and drains active jobs', async () => {
    const { queues, service, shutdownSignal } = createQueueMocks();
    const logSpy = jest.spyOn(service['logger'] as Logger, 'log');

    await service.onApplicationShutdown('SIGTERM');

    expect(shutdownSignal.trigger).toHaveBeenCalled();
    for (const name of QUEUE_NAMES) {
      expect(queues[name].pause).toHaveBeenCalled();
      expect(queues[name].getActiveCount).toHaveBeenCalled();
    }
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Shutdown signal received: SIGTERM'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Graceful shutdown complete'));
  });

  it('logs "unknown" when no signal name is provided', async () => {
    const { service } = createQueueMocks();
    const logSpy = jest.spyOn(service['logger'] as Logger, 'log');

    await service.onApplicationShutdown();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Shutdown signal received: unknown'));
  });

  it('polls active jobs and logs progress until all complete', async () => {
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

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Shutdown timeout reached. Remaining active jobs: order-queue: 1')
    );
  });

  it('continues pausing remaining queues when one fails', async () => {
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

  describe('resumeAllQueues on bootstrap', () => {
    it('resumes a paused queue and logs a warning', async () => {
      const { queues, service } = createQueueMocks({
        'order-queue': {
          isPaused: jest.fn().mockResolvedValue(true)
        }
      });
      const warnSpy = jest.spyOn(service['logger'] as Logger, 'warn');

      await service.onApplicationBootstrap();

      expect(queues['order-queue'].resume).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Resumed paused queue: order-queue'));
    });

    it('does not resume queues that are not paused', async () => {
      const { queues, service } = createQueueMocks();

      await service.onApplicationBootstrap();

      for (const name of QUEUE_NAMES) {
        expect(queues[name].resume).not.toHaveBeenCalled();
      }
    });

    it('continues resuming other queues when one fails', async () => {
      const { queues, service } = createQueueMocks({
        'order-queue': {
          isPaused: jest.fn().mockRejectedValue(new Error('redis down'))
        },
        'paper-trading': {
          isPaused: jest.fn().mockResolvedValue(true)
        }
      });
      const errorSpy = jest.spyOn(service['logger'] as Logger, 'error');

      await service.onApplicationBootstrap();

      expect(queues['paper-trading'].resume).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to resume queue order-queue: redis down'),
        expect.any(String)
      );
    });
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
