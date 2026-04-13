import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { type Repository } from 'typeorm';

import { CoinDailySnapshot } from './coin-daily-snapshot.entity';
import { CoinDailySnapshotService } from './coin-daily-snapshot.service';
import { type Coin } from './coin.entity';

const createTestCoin = (overrides: Partial<Coin> = {}): Coin =>
  ({
    id: 'coin-123',
    slug: 'bitcoin',
    name: 'Bitcoin',
    symbol: 'BTC',
    marketCap: 800_000_000_000,
    totalVolume: 35_000_000_000,
    currentPrice: 43000,
    circulatingSupply: 19_400_000,
    marketRank: 1,
    ...overrides
  }) as Coin;

describe('CoinDailySnapshotService', () => {
  let service: CoinDailySnapshotService;
  let repo: jest.Mocked<Repository<CoinDailySnapshot>>;

  // Reusable mock query builder
  let mockQb: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockQb = {
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orUpdate: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ identifiers: [{ id: 'snap-1' }] }),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      distinctOn: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([])
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoinDailySnapshotService,
        {
          provide: getRepositoryToken(CoinDailySnapshot),
          useValue: {
            createQueryBuilder: jest.fn().mockReturnValue(mockQb),
            count: jest.fn().mockResolvedValue(0),
            delete: jest.fn().mockResolvedValue({ affected: 0 })
          }
        }
      ]
    }).compile();

    service = module.get<CoinDailySnapshotService>(CoinDailySnapshotService);
    repo = module.get(getRepositoryToken(CoinDailySnapshot));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ===========================================================================
  // captureSnapshots()
  // ===========================================================================
  describe('captureSnapshots()', () => {
    it("inserts one row per coin with today's date and market data", async () => {
      const coins = [
        createTestCoin({ id: 'coin-1', marketCap: 500_000_000_000, currentPrice: 30000 }),
        createTestCoin({
          id: 'coin-2',
          slug: 'ethereum',
          name: 'Ethereum',
          symbol: 'ETH',
          marketCap: 200_000_000_000,
          currentPrice: 2000
        })
      ];

      mockQb.execute.mockResolvedValueOnce({ identifiers: [{ id: 'snap-1' }, { id: 'snap-2' }] });

      const count = await service.captureSnapshots(coins);

      expect(count).toBe(2);
      expect(mockQb.insert).toHaveBeenCalled();
      expect(mockQb.values).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ coinId: 'coin-1', marketCap: 500_000_000_000, currentPrice: 30000 }),
          expect.objectContaining({ coinId: 'coin-2', marketCap: 200_000_000_000, currentPrice: 2000 })
        ])
      );
      expect(mockQb.orUpdate).toHaveBeenCalledWith(
        ['marketCap', 'totalVolume', 'currentPrice', 'circulatingSupply', 'marketRank'],
        ['coinId', 'snapshotDate']
      );
    });

    it('is idempotent — uses upsert (orUpdate) so calling twice does not fail', async () => {
      const coins = [createTestCoin()];

      mockQb.execute.mockResolvedValue({ identifiers: [{ id: 'snap-1' }] });

      await service.captureSnapshots(coins);
      await service.captureSnapshots(coins);

      expect(mockQb.orUpdate).toHaveBeenCalledTimes(2);
      expect(mockQb.execute).toHaveBeenCalledTimes(2);
    });

    it('returns 0 and does nothing for empty array', async () => {
      const count = await service.captureSnapshots([]);

      expect(count).toBe(0);
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // getSnapshotsAtDate()
  // ===========================================================================
  describe('getSnapshotsAtDate()', () => {
    it('returns the snapshot closest to (but not after) the given date for each coin', async () => {
      const snapshot = {
        id: 'snap-1',
        coinId: 'coin-1',
        snapshotDate: '2025-06-01',
        marketCap: 500_000_000_000,
        totalVolume: 10_000_000_000,
        currentPrice: 30000,
        circulatingSupply: 19_000_000,
        marketRank: 1
      } as unknown as CoinDailySnapshot;

      mockQb.getMany.mockResolvedValueOnce([snapshot]);

      const result = await service.getSnapshotsAtDate(['coin-1'], new Date('2025-06-15'));

      expect(result).toEqual([snapshot]);
      expect(mockQb.where).toHaveBeenCalledWith('s.coinId IN (:...coinIds)', { coinIds: ['coin-1'] });
      expect(mockQb.andWhere).toHaveBeenCalledWith('s.snapshotDate <= :date', { date: '2025-06-15' });
      expect(mockQb.distinctOn).toHaveBeenCalledWith(['s.coinId']);
      expect(mockQb.orderBy).toHaveBeenCalledWith('s.coinId');
      expect(mockQb.addOrderBy).toHaveBeenCalledWith('s.snapshotDate', 'DESC');
    });

    it('returns empty array when no snapshots exist before date', async () => {
      mockQb.getMany.mockResolvedValueOnce([]);

      const result = await service.getSnapshotsAtDate(['coin-1'], new Date('2020-01-01'));

      expect(result).toEqual([]);
    });

    it('returns empty array for empty coinIds', async () => {
      const result = await service.getSnapshotsAtDate([], new Date());

      expect(result).toEqual([]);
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // getQualifiedCoinIdsAtDate()
  // ===========================================================================
  describe('getQualifiedCoinIdsAtDate()', () => {
    it('filters by historical market cap and volume', async () => {
      const snapshots = [
        {
          coinId: 'coin-1',
          marketCap: 500_000_000_000,
          totalVolume: 10_000_000_000,
          currentPrice: 30000
        },
        {
          coinId: 'coin-2',
          marketCap: 50_000_000, // below 100M threshold
          totalVolume: 5_000_000,
          currentPrice: 0.5
        },
        {
          coinId: 'coin-3',
          marketCap: 200_000_000_000,
          totalVolume: 500_000, // below 1M threshold
          currentPrice: 2000
        }
      ] as unknown as CoinDailySnapshot[];

      mockQb.getMany.mockResolvedValueOnce(snapshots);

      const result = await service.getQualifiedCoinIdsAtDate(['coin-1', 'coin-2', 'coin-3'], new Date('2025-06-15'));

      expect(result).toEqual({ qualifiedIds: ['coin-1'], hasSnapshots: true });
    });

    it('returns hasSnapshots: true with empty qualifiedIds when snapshots exist but none qualify', async () => {
      const snapshots = [
        {
          coinId: 'coin-1',
          marketCap: 50_000_000, // below threshold
          totalVolume: 500_000, // below threshold
          currentPrice: 1
        }
      ] as unknown as CoinDailySnapshot[];

      mockQb.getMany.mockResolvedValueOnce(snapshots);

      const result = await service.getQualifiedCoinIdsAtDate(['coin-1'], new Date('2025-06-15'));

      expect(result).toEqual({ qualifiedIds: [], hasSnapshots: true });
    });

    it('returns hasSnapshots: false when no snapshots exist', async () => {
      mockQb.getMany.mockResolvedValueOnce([]);

      const result = await service.getQualifiedCoinIdsAtDate(['coin-1'], new Date('2025-06-15'));

      expect(result).toEqual({ qualifiedIds: [], hasSnapshots: false });
    });

    it('sorts qualified IDs by historical marketCap DESC', async () => {
      const snapshots = [
        {
          coinId: 'coin-small',
          marketCap: 200_000_000,
          totalVolume: 5_000_000,
          currentPrice: 10
        },
        {
          coinId: 'coin-large',
          marketCap: 500_000_000_000,
          totalVolume: 10_000_000_000,
          currentPrice: 30000
        },
        {
          coinId: 'coin-medium',
          marketCap: 50_000_000_000,
          totalVolume: 2_000_000_000,
          currentPrice: 2000
        }
      ] as unknown as CoinDailySnapshot[];

      mockQb.getMany.mockResolvedValueOnce(snapshots);

      const result = await service.getQualifiedCoinIdsAtDate(
        ['coin-small', 'coin-large', 'coin-medium'],
        new Date('2025-06-15')
      );

      expect(result.qualifiedIds).toEqual(['coin-large', 'coin-medium', 'coin-small']);
    });

    it('qualifies coin with null currentPrice when marketCap and volume are valid', async () => {
      const snapshots = [
        {
          coinId: 'coin-akt',
          marketCap: 116_000_000,
          totalVolume: 4_500_000,
          currentPrice: null
        }
      ] as unknown as CoinDailySnapshot[];

      mockQb.getMany.mockResolvedValueOnce(snapshots);

      const result = await service.getQualifiedCoinIdsAtDate(['coin-akt'], new Date('2025-06-15'));

      expect(result).toEqual({ qualifiedIds: ['coin-akt'], hasSnapshots: true });
    });

    it('returns empty for empty coinIds', async () => {
      const result = await service.getQualifiedCoinIdsAtDate([], new Date());

      expect(result).toEqual({ qualifiedIds: [], hasSnapshots: false });
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // backfillFromHistoricalData()
  // ===========================================================================
  describe('backfillFromHistoricalData()', () => {
    beforeEach(() => {
      mockQb.orIgnore = jest.fn().mockReturnThis();
    });

    it('inserts snapshots from historical price data using orIgnore', async () => {
      const prices = [
        { timestamp: 1704067200000, price: 42000, volume: 10_000_000_000, marketCap: 800_000_000_000 },
        { timestamp: 1704153600000, price: 43000, volume: 11_000_000_000, marketCap: 820_000_000_000 }
      ];

      mockQb.execute.mockResolvedValueOnce({ identifiers: [{ id: 'snap-1' }, { id: 'snap-2' }] });

      const count = await service.backfillFromHistoricalData('coin-1', prices);

      expect(count).toBe(2);
      expect(mockQb.insert).toHaveBeenCalled();
      expect(mockQb.values).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ coinId: 'coin-1', currentPrice: 42000, circulatingSupply: null, marketRank: null }),
          expect.objectContaining({ coinId: 'coin-1', currentPrice: 43000 })
        ])
      );
      expect(mockQb.orIgnore).toHaveBeenCalled();
    });

    it('returns 0 for empty prices array', async () => {
      const count = await service.backfillFromHistoricalData('coin-1', []);

      expect(count).toBe(0);
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('handles optional marketCap by defaulting to null', async () => {
      const prices = [{ timestamp: 1704067200000, price: 42000, volume: 10_000_000_000 }];

      mockQb.execute.mockResolvedValueOnce({ identifiers: [{ id: 'snap-1' }] });

      await service.backfillFromHistoricalData('coin-1', prices);

      expect(mockQb.values).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ coinId: 'coin-1', marketCap: null })])
      );
    });
  });

  // ===========================================================================
  // getCoinsNeedingBackfill()
  // ===========================================================================
  describe('getCoinsNeedingBackfill()', () => {
    it('returns coins with fewer than minDays snapshots', async () => {
      mockQb.getRawMany.mockResolvedValueOnce([
        { coinId: 'coin-1', cnt: '10' },
        { coinId: 'coin-2', cnt: '45' }
      ]);

      const result = await service.getCoinsNeedingBackfill(['coin-1', 'coin-2', 'coin-3'], 30);

      expect(result).toEqual(['coin-1', 'coin-3']); // coin-3 has 0, coin-1 has 10
    });

    it('returns empty array for empty coinIds', async () => {
      const result = await service.getCoinsNeedingBackfill([], 30);

      expect(result).toEqual([]);
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // pruneOldSnapshots()
  // ===========================================================================
  describe('pruneOldSnapshots()', () => {
    it('deletes snapshots older than retention period', async () => {
      (repo.delete as jest.Mock).mockResolvedValueOnce({ affected: 100 });

      const result = await service.pruneOldSnapshots(365);

      expect(result).toBe(100);
      expect(repo.delete).toHaveBeenCalled();
    });

    it('returns 0 when no snapshots are pruned', async () => {
      (repo.delete as jest.Mock).mockResolvedValueOnce({ affected: 0 });

      const result = await service.pruneOldSnapshots(730);

      expect(result).toBe(0);
    });
  });

  // ===========================================================================
  // getSnapshotCount()
  // ===========================================================================
  describe('getSnapshotCount()', () => {
    it('returns the total count of snapshots', async () => {
      (repo.count as jest.Mock).mockResolvedValueOnce(1500);

      const result = await service.getSnapshotCount();

      expect(result).toBe(1500);
    });
  });
});
