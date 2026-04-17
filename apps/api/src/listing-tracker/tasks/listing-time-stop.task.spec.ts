import { ListingTimeStopTask } from './listing-time-stop.task';

import { ListingPositionStatus, ListingStrategyType } from '../entities/listing-trade-position.entity';

describe('ListingTimeStopTask', () => {
  let positionRepo: any;
  let orderRepo: any;
  let userRepo: any;
  let executor: any;
  let hedgeService: any;
  let task: ListingTimeStopTask;

  beforeEach(() => {
    positionRepo = { find: jest.fn() };
    orderRepo = { findOne: jest.fn() };
    userRepo = { findOne: jest.fn().mockResolvedValue({ id: 'u1' }) };
    executor = { closePosition: jest.fn() };
    hedgeService = { closeShort: jest.fn() };

    const queue = { getRepeatableJobs: jest.fn().mockResolvedValue([]), add: jest.fn() };
    const config = { get: jest.fn().mockReturnValue('true') };
    const failedJobService = {} as any;

    task = new ListingTimeStopTask(
      queue as any,
      positionRepo as any,
      orderRepo as any,
      userRepo as any,
      executor as any,
      hedgeService as any,
      config as any,
      failedJobService
    );
  });

  function makeJob(name: string) {
    return { name } as any;
  }

  it('returns early when no positions are expired', async () => {
    positionRepo.find = jest.fn().mockResolvedValue([]);
    const result = await task.process(makeJob('listing-time-stop-sweep'));
    expect(result).toEqual({ closed: 0 });
    expect(executor.closePosition).not.toHaveBeenCalled();
  });

  it('closes expired OPEN positions and closes hedge if present', async () => {
    const expired = {
      id: 'pos-1',
      userId: 'u1',
      orderId: 'o1',
      hedgeOrderId: 'h1',
      hedgeOrder: { id: 'h1' },
      status: ListingPositionStatus.OPEN,
      strategyType: ListingStrategyType.POST_ANNOUNCEMENT,
      expiresAt: new Date(Date.now() - 1000)
    };
    positionRepo.find = jest.fn().mockResolvedValue([expired]);
    executor.closePosition = jest
      .fn()
      .mockResolvedValue({ ...expired, status: ListingPositionStatus.EXITED_TIME_STOP });

    const result = await task.process(makeJob('listing-time-stop-sweep'));

    expect(result).toEqual({ closed: 1 });
    expect(executor.closePosition).toHaveBeenCalledWith({
      position: expired,
      nextStatus: ListingPositionStatus.EXITED_TIME_STOP,
      reason: 'time_stop'
    });
    expect(hedgeService.closeShort).toHaveBeenCalled();
  });

  it('ignores non-matching job names', async () => {
    const result = await task.process(makeJob('something-else'));
    expect(result).toBeUndefined();
    expect(positionRepo.find).not.toHaveBeenCalled();
  });
});
