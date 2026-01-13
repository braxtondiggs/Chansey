import { Job } from 'bullmq';

import { OHLCPruneTask } from './ohlc-prune.task';

import { OHLCService } from '../ohlc.service';

describe('OHLCPruneTask', () => {
  let task: OHLCPruneTask;
  let queue: { getRepeatableJobs: jest.Mock; add: jest.Mock };
  let ohlcService: jest.Mocked<OHLCService>;
  let configService: { get: jest.Mock };

  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };

    queue = {
      getRepeatableJobs: jest.fn().mockResolvedValue([]),
      add: jest.fn().mockResolvedValue(undefined)
    };

    ohlcService = {
      getCandleCount: jest.fn(),
      pruneOldCandles: jest.fn()
    } as unknown as jest.Mocked<OHLCService>;

    configService = { get: jest.fn() };

    task = new OHLCPruneTask(queue as any, ohlcService, configService as any);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it('onModuleInit skips scheduling in development', async () => {
    process.env.NODE_ENV = 'development';
    const scheduleSpy = jest.spyOn(task as any, 'schedulePruneJob').mockResolvedValue(undefined);

    await task.onModuleInit();

    expect(scheduleSpy).not.toHaveBeenCalled();
  });

  it('handlePrune returns summary', async () => {
    configService.get.mockReturnValue('30');
    ohlcService.getCandleCount.mockResolvedValueOnce(100).mockResolvedValueOnce(60);
    ohlcService.pruneOldCandles.mockResolvedValue(40);

    const job = { updateProgress: jest.fn(), name: 'ohlc-prune', id: 'job-1' } as unknown as Job;
    const result = await task.handlePrune(job);

    expect(result.retentionDays).toBe(30);
    expect(result.candlesDeleted).toBe(40);
    expect(result.candlesBefore).toBe(100);
    expect(result.candlesAfter).toBe(60);
  });

  it('process calls handlePrune', async () => {
    const handleSpy = jest.spyOn(task, 'handlePrune').mockResolvedValue({
      retentionDays: 365,
      candlesBefore: 100,
      candlesAfter: 100,
      candlesDeleted: 0,
      prunedAt: new Date().toISOString()
    });
    const job = { name: 'ohlc-prune', id: 'job-1' } as Job;

    await task.process(job);

    expect(handleSpy).toHaveBeenCalledWith(job);
  });
});
