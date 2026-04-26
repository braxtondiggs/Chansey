import { ListingSelectionCleanupTask } from './listing-selection-cleanup.task';

import { CoinSelectionSource } from '../../coin-selection/coin-selection-source.enum';
import { CoinSelectionType } from '../../coin-selection/coin-selection-type.enum';
import { ListingPositionStatus } from '../entities/listing-trade-position.entity';

const HOUR_MS = 60 * 60 * 1000;

interface FakeSelection {
  id: string;
  user: { id: string };
  coin: { id: string };
  createdAt: Date;
}

interface FakePosition {
  userId: string;
  coinId: string;
  status: ListingPositionStatus;
}

describe('ListingSelectionCleanupTask', () => {
  let selectionRepo: any;
  let positionRepo: any;
  let coinSelectionService: any;
  let task: ListingSelectionCleanupTask;
  let selectionsStore: FakeSelection[];
  let positionsStore: FakePosition[];

  const makeSelectionRepo = () => {
    const find = jest.fn().mockImplementation(() => Promise.resolve(selectionsStore));
    const createQueryBuilder = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawMany: jest
        .fn()
        .mockImplementation(() => Promise.resolve(selectionsStore.map((s) => ({ id: s.id, createdAt: s.createdAt }))))
    });
    return { find, createQueryBuilder };
  };

  beforeEach(() => {
    selectionsStore = [];
    positionsStore = [];

    selectionRepo = makeSelectionRepo();

    // typeorm's In(arr) returns a FindOperator whose array is exposed via `.value`.
    positionRepo = {
      find: jest.fn().mockImplementation(({ where }: any) => {
        const userId = where.userId;
        const container = where.coinId;
        const ids: string[] = Array.isArray(container) ? container : (container?.value ?? []);
        return Promise.resolve(positionsStore.filter((p) => p.userId === userId && ids.includes(p.coinId)));
      })
    };

    coinSelectionService = {
      bulkDeleteSelectionsByIds: jest.fn().mockResolvedValue({ affected: 0 })
    };

    const queue = { getRepeatableJobs: jest.fn().mockResolvedValue([]), add: jest.fn() } as any;
    const config = { get: jest.fn().mockReturnValue('true') } as any;
    const failedJobService = {} as any;

    task = new ListingSelectionCleanupTask(
      queue,
      selectionRepo,
      positionRepo,
      coinSelectionService,
      config,
      failedJobService
    );
  });

  function makeJob(name = 'listing-selection-cleanup-sweep') {
    return { name } as any;
  }

  function addSelection(opts: { id: string; userId: string; coinId: string; ageHours: number }): void {
    selectionsStore.push({
      id: opts.id,
      user: { id: opts.userId },
      coin: { id: opts.coinId },
      createdAt: new Date(Date.now() - opts.ageHours * HOUR_MS)
    });
  }

  function addPosition(userId: string, coinId: string, status: ListingPositionStatus): void {
    positionsStore.push({ userId, coinId, status });
  }

  it('returns 0 when there are no listing selections', async () => {
    const result = await task.process(makeJob());
    expect(result).toEqual({ usersProcessed: 0, coinsRemoved: 0 });
    expect(coinSelectionService.bulkDeleteSelectionsByIds).not.toHaveBeenCalled();
  });

  it('ignores non-matching job names', async () => {
    addSelection({ id: 'sel-1', userId: 'u1', coinId: 'c1', ageHours: 100 });
    const result = await task.process(makeJob('something-else'));
    expect(result).toBeUndefined();
    expect(selectionRepo.find).not.toHaveBeenCalled();
  });

  it('deletes selections whose only positions are all in terminal states', async () => {
    addSelection({ id: 'sel-1', userId: 'u1', coinId: 'c1', ageHours: 200 });
    addPosition('u1', 'c1', ListingPositionStatus.EXITED_TP);
    addPosition('u1', 'c1', ListingPositionStatus.EXITED_SL);

    const result = await task.process(makeJob());

    expect(result).toEqual({ usersProcessed: 1, coinsRemoved: 0 });
    expect(coinSelectionService.bulkDeleteSelectionsByIds).toHaveBeenCalledWith(
      'u1',
      expect.arrayContaining(['sel-1'])
    );
  });

  it('keeps selections that have at least one non-terminal position (no delete call)', async () => {
    addSelection({ id: 'sel-1', userId: 'u1', coinId: 'c1', ageHours: 100 });
    addPosition('u1', 'c1', ListingPositionStatus.OPEN);
    addPosition('u1', 'c1', ListingPositionStatus.EXITED_TP);

    const result = await task.process(makeJob());

    // All coins kept → bulkDelete is skipped (no DB roundtrip needed).
    expect(coinSelectionService.bulkDeleteSelectionsByIds).not.toHaveBeenCalled();
    expect(result).toEqual({ usersProcessed: 1, coinsRemoved: 0 });
  });

  it('keeps orphaned selections younger than the grace period (no delete call)', async () => {
    // Position never created. Selection is fresh (within 48h grace).
    addSelection({ id: 'sel-1', userId: 'u1', coinId: 'c1', ageHours: 12 });

    await task.process(makeJob());

    expect(coinSelectionService.bulkDeleteSelectionsByIds).not.toHaveBeenCalled();
  });

  it('deletes orphaned selections older than the grace period', async () => {
    // Position never created. Selection is old enough that the listing trade clearly never executed.
    addSelection({ id: 'sel-1', userId: 'u1', coinId: 'c1', ageHours: 72 });

    await task.process(makeJob());

    expect(coinSelectionService.bulkDeleteSelectionsByIds).toHaveBeenCalledWith(
      'u1',
      expect.arrayContaining(['sel-1'])
    );
  });

  it('processes multiple users independently — only deletes for users with stale rows', async () => {
    addSelection({ id: 'sel-1', userId: 'u1', coinId: 'c1', ageHours: 200 });
    addSelection({ id: 'sel-2', userId: 'u2', coinId: 'c2', ageHours: 200 });
    addPosition('u1', 'c1', ListingPositionStatus.EXITED_TP); // u1 has stale row
    addPosition('u2', 'c2', ListingPositionStatus.OPEN); // u2 row is alive

    const result = await task.process(makeJob());

    expect(result?.usersProcessed).toBe(2);
    // Only u1 has a row to delete; u2 is fully kept so no call.
    expect(coinSelectionService.bulkDeleteSelectionsByIds).toHaveBeenCalledTimes(1);
    expect(coinSelectionService.bulkDeleteSelectionsByIds).toHaveBeenCalledWith(
      'u1',
      expect.arrayContaining(['sel-1'])
    );
  });

  it('does not delete a selection inserted after the snapshot is loaded', async () => {
    // sel-1 is observed by the sweep and is stale. sel-2 is inserted concurrently
    // *after* the snapshot is loaded — it must not appear in the delete payload.
    addSelection({ id: 'sel-1', userId: 'u1', coinId: 'c1', ageHours: 200 });
    addPosition('u1', 'c1', ListingPositionStatus.EXITED_TP);

    // Mimic a concurrent insert: the find() returns only sel-1 (the snapshot),
    // but a new row appears in the underlying store immediately after.
    selectionRepo.find = jest.fn().mockImplementationOnce(() => {
      const snapshot = [...selectionsStore];
      // Insert a brand-new selection *after* the snapshot is captured.
      selectionsStore.push({
        id: 'sel-2-concurrent',
        user: { id: 'u1' },
        coin: { id: 'c2' },
        createdAt: new Date()
      });
      return Promise.resolve(snapshot);
    });

    await task.process(makeJob());

    expect(coinSelectionService.bulkDeleteSelectionsByIds).toHaveBeenCalledTimes(1);
    const [calledUserId, calledIds] = coinSelectionService.bulkDeleteSelectionsByIds.mock.calls[0];
    expect(calledUserId).toBe('u1');
    expect(calledIds).toEqual(['sel-1']);
    expect(calledIds).not.toContain('sel-2-concurrent');
  });

  it('uses the LISTING source filter and AUTOMATIC type filter when querying', async () => {
    addSelection({ id: 'sel-1', userId: 'u1', coinId: 'c1', ageHours: 200 });
    addPosition('u1', 'c1', ListingPositionStatus.EXITED_TP);

    await task.process(makeJob());

    expect(selectionRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: CoinSelectionType.AUTOMATIC,
          source: CoinSelectionSource.LISTING
        })
      })
    );
  });
});
