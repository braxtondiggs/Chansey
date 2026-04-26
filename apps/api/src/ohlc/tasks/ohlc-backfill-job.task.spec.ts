import { type Job } from 'bullmq';

import { OHLCBackfillJobTask } from './ohlc-backfill-job.task';

import { type OHLCBackfillService } from '../services/ohlc-backfill.service';

describe('OHLCBackfillJobTask', () => {
  let task: OHLCBackfillJobTask;
  let backfillService: jest.Mocked<Pick<OHLCBackfillService, 'runBackfill'>>;

  beforeEach(() => {
    backfillService = {
      runBackfill: jest.fn().mockResolvedValue(undefined)
    } as unknown as jest.Mocked<Pick<OHLCBackfillService, 'runBackfill'>>;

    task = new OHLCBackfillJobTask(backfillService as any, { recordFailure: jest.fn() } as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('process invokes runBackfill with the job coinId', async () => {
    const job = { id: 'job-1', name: 'backfill', data: { coinId: 'btc' } } as Job<{ coinId: string }>;

    await task.process(job);

    expect(backfillService.runBackfill).toHaveBeenCalledWith('btc');
  });

  it('process rethrows when runBackfill throws so BullMQ records the failure', async () => {
    backfillService.runBackfill.mockRejectedValue(new Error('exchange unreachable'));
    const job = { id: 'job-1', name: 'backfill', data: { coinId: 'btc' } } as Job<{ coinId: string }>;

    await expect(task.process(job)).rejects.toThrow('exchange unreachable');
  });

  it('onModuleInit sets worker concurrency to 2', () => {
    const worker = { concurrency: 0 };
    Object.defineProperty(task, 'worker', { value: worker, configurable: true });

    task.onModuleInit();

    expect(worker.concurrency).toBe(2);
  });
});
