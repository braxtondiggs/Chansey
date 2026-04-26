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

  const buildJob = () =>
    ({
      id: 'job-1',
      name: 'backfill',
      data: {
        coinId: 'btc',
        symbol: 'BTC/USD',
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-01-02T00:00:00.000Z'
      }
    }) as Job<{ coinId: string; symbol: string; startDate: string; endDate: string }>;

  it('process invokes runBackfill with resolved symbol and date range', async () => {
    await task.process(buildJob());

    expect(backfillService.runBackfill).toHaveBeenCalledWith(
      'btc',
      'BTC/USD',
      new Date('2024-01-01T00:00:00.000Z'),
      new Date('2024-01-02T00:00:00.000Z')
    );
  });

  it('process rethrows when runBackfill throws so BullMQ records the failure', async () => {
    backfillService.runBackfill.mockRejectedValue(new Error('exchange unreachable'));

    await expect(task.process(buildJob())).rejects.toThrow('exchange unreachable');
  });

  it('onModuleInit sets worker concurrency to 2', () => {
    const worker = { concurrency: 0 };
    Object.defineProperty(task, 'worker', { value: worker, configurable: true });

    task.onModuleInit();

    expect(worker.concurrency).toBe(2);
  });
});
