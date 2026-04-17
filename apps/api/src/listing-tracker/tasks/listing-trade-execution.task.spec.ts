import { SignalSource, SignalStatus, LiveTradingSignalAction } from '@chansey/api-interfaces';

import { ListingTradeExecutionTask } from './listing-trade-execution.task';

import { ListingStrategyType } from '../entities/listing-trade-position.entity';
import { LISTING_TRADE_EXECUTION_JOB, type ListingTradeExecutionJobData } from '../services/listing-tracker.service';

describe('ListingTradeExecutionTask', () => {
  let userRepo: any;
  let coinRepo: any;
  let orderRepo: any;
  let executor: any;
  let hedgeService: any;
  let liveSignalService: any;
  let lockService: any;
  let task: ListingTradeExecutionTask;

  const user = { id: 'user-5', effectiveCalculationRiskLevel: 5 };
  const coin = { id: 'coin-1', symbol: 'FOO' };

  beforeEach(() => {
    userRepo = { findOne: jest.fn().mockResolvedValue(user) };
    coinRepo = { findOne: jest.fn().mockResolvedValue(coin) };
    orderRepo = { findOne: jest.fn().mockResolvedValue({ id: 'spot-order-1' }) };
    executor = {
      hasOpenPositionForCoin: jest.fn().mockResolvedValue(false),
      countActivePositions: jest.fn().mockResolvedValue(0),
      executeBuy: jest.fn().mockResolvedValue({ id: 'pos-1', orderId: 'spot-order-1' })
    };
    hedgeService = { openShort: jest.fn().mockResolvedValue({ id: 'hedge-1' }) };
    liveSignalService = { recordOutcome: jest.fn().mockResolvedValue(undefined) };
    lockService = {
      acquire: jest.fn().mockResolvedValue({ acquired: true, lockId: 'lid', token: 'tok' }),
      release: jest.fn().mockResolvedValue(true)
    };
    const failedJobService = {} as any;

    task = new ListingTradeExecutionTask(
      userRepo,
      coinRepo,
      orderRepo,
      executor,
      hedgeService,
      liveSignalService,
      lockService,
      failedJobService
    );
  });

  function makeJob(overrides: Partial<ListingTradeExecutionJobData> = {}) {
    return {
      name: LISTING_TRADE_EXECUTION_JOB,
      data: {
        userId: 'user-5',
        coinId: 'coin-1',
        strategyType: ListingStrategyType.POST_ANNOUNCEMENT,
        announcementId: null,
        candidateId: null,
        ...overrides
      }
    } as any;
  }

  it('acquires lock, executes buy, records success, and opens hedge (risk-5 post-announcement)', async () => {
    const result = await task.process(makeJob());

    expect(lockService.acquire).toHaveBeenCalledWith(expect.objectContaining({ key: 'listing-trade:user:user-5' }));
    expect(executor.executeBuy).toHaveBeenCalled();
    expect(liveSignalService.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-5',
        symbol: 'FOO',
        status: SignalStatus.PLACED,
        source: SignalSource.LISTING_TRACKER
      })
    );
    expect(hedgeService.openShort).toHaveBeenCalled();
    expect(lockService.release).toHaveBeenCalledWith('listing-trade:user:user-5', 'tok');
    expect(result).toEqual({ positionId: 'pos-1' });
  });

  it('returns lock_not_acquired skip when lock is contended', async () => {
    lockService.acquire.mockResolvedValue({ acquired: false, lockId: null, token: null });

    const result = await task.process(makeJob());

    expect(result).toEqual({ skipped: 'lock_not_acquired' });
    expect(executor.executeBuy).not.toHaveBeenCalled();
    expect(lockService.release).not.toHaveBeenCalled();
  });

  it('releases the lock even when executeBuy throws', async () => {
    executor.executeBuy.mockRejectedValue(new Error('exchange down'));

    await expect(task.process(makeJob())).rejects.toThrow('exchange down');

    expect(lockService.release).toHaveBeenCalledWith('listing-trade:user:user-5', 'tok');
  });

  it('records failure with the real coin symbol (not the coinId UUID) when executeBuy throws', async () => {
    executor.executeBuy.mockRejectedValue(new Error('boom'));

    await expect(task.process(makeJob())).rejects.toThrow('boom');

    expect(liveSignalService.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-5',
        symbol: 'FOO',
        status: SignalStatus.FAILED,
        action: LiveTradingSignalAction.BUY,
        reason: 'boom'
      })
    );
    // Must never be called with the raw coinId UUID
    expect(liveSignalService.recordOutcome).not.toHaveBeenCalledWith(expect.objectContaining({ symbol: 'coin-1' }));
  });

  it('falls back to "unknown" symbol when coin lookup fails before the error', async () => {
    userRepo.findOne.mockResolvedValue(null);
    // This path returns a skip — but simulate a pre-lookup throw to exercise the fallback
    coinRepo.findOne.mockRejectedValue(new Error('db down'));

    await expect(task.process(makeJob())).rejects.toThrow('db down');

    expect(liveSignalService.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'unknown', status: SignalStatus.FAILED })
    );
  });

  it('skips when user or coin is missing', async () => {
    userRepo.findOne.mockResolvedValue(null);

    const result = await task.process(makeJob());

    expect(result).toEqual({ skipped: 'missing-user-or-coin' });
    expect(lockService.acquire).not.toHaveBeenCalled();
  });

  it('skips when risk config is missing (e.g. risk-3 user)', async () => {
    userRepo.findOne.mockResolvedValue({ ...user, effectiveCalculationRiskLevel: 3 });

    const result = await task.process(makeJob());

    expect(result).toEqual({ skipped: 'no-risk-config' });
    expect(lockService.acquire).not.toHaveBeenCalled();
  });

  it('skips when user already holds the coin', async () => {
    executor.hasOpenPositionForCoin.mockResolvedValue(true);

    const result = await task.process(makeJob());

    expect(result).toEqual({ skipped: 'already-holding' });
    expect(executor.executeBuy).not.toHaveBeenCalled();
    expect(lockService.release).toHaveBeenCalled();
  });

  it('skips when user is already at max concurrent listing positions', async () => {
    executor.countActivePositions.mockResolvedValue(10);

    const result = await task.process(makeJob());

    expect(result).toEqual({ skipped: 'max-concurrent' });
    expect(executor.executeBuy).not.toHaveBeenCalled();
    expect(lockService.release).toHaveBeenCalled();
  });
});
