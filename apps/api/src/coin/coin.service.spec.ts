import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { type FindManyOptions, type FindOneOptions, In, IsNull, type Repository } from 'typeorm';

import { CoinDailySnapshotService } from './coin-daily-snapshot.service';
import { CoinDiversityService } from './coin-diversity.service';
import { Coin } from './coin.entity';
import { CoinService } from './coin.service';

import { CoinNotFoundException } from '../common/exceptions/resource';

const createTestCoin = (overrides: Partial<Coin> & Record<string, unknown> = {}): Coin => {
  const now = new Date();
  return {
    id: (overrides.id as string) ?? 'coin-123',
    slug: (overrides.slug as string) ?? 'bitcoin',
    name: (overrides.name as string) ?? 'Bitcoin',
    symbol: (overrides.symbol as string) ?? 'BTC',
    createdAt: (overrides.createdAt as Date) ?? now,
    updatedAt: (overrides.updatedAt as Date) ?? now,
    ...overrides
  } as Coin;
};

const mockQueryBuilder = () => {
  const qb: Record<string, jest.Mock> = {};
  qb.where = jest.fn().mockReturnValue(qb);
  qb.andWhere = jest.fn().mockReturnValue(qb);
  qb.orderBy = jest.fn().mockReturnValue(qb);
  qb.addOrderBy = jest.fn().mockReturnValue(qb);
  qb.take = jest.fn().mockReturnValue(qb);
  qb.update = jest.fn().mockReturnValue(qb);
  qb.set = jest.fn().mockReturnValue(qb);
  qb.execute = jest.fn().mockResolvedValue(undefined);
  qb.getMany = jest.fn().mockResolvedValue([]);
  return qb;
};

describe('CoinService', () => {
  let service: CoinService;
  let coinRepository: jest.Mocked<Repository<Coin>>;
  let snapshotService: { getQualifiedCoinIdsAtDate: jest.Mock };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoinService,
        {
          provide: getRepositoryToken(Coin),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder()),
            update: jest.fn().mockResolvedValue(undefined),
            delete: jest.fn(),
            insert: jest.fn()
          }
        },
        {
          provide: CoinDailySnapshotService,
          useValue: {
            getQualifiedCoinIdsAtDate: jest.fn().mockResolvedValue({ qualifiedIds: [], hasSnapshots: false })
          }
        },
        {
          provide: CoinDiversityService,
          useValue: {
            // Default: identity pruning. Individual tests override as needed.
            pruneByDiversity: jest
              .fn()
              .mockImplementation((shortlist: Coin[], take: number) => shortlist.slice(0, take))
          }
        }
      ]
    }).compile();

    service = module.get<CoinService>(CoinService);
    coinRepository = module.get(getRepositoryToken(Coin));
    snapshotService = module.get(CoinDailySnapshotService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ===========================================================================
  // isVirtualCoin() (static)
  // ===========================================================================
  describe('isVirtualCoin()', () => {
    it.each([
      ['USD-virtual', true],
      ['ETH-virtual', true],
      ['coin-123', false],
      [undefined as unknown as string, false]
    ])('returns %s for id "%s"', (id, expected) => {
      expect(CoinService.isVirtualCoin({ id } as Coin)).toBe(expected);
    });
  });

  // ===========================================================================
  // getCoinBySymbol()
  // ===========================================================================
  describe('getCoinBySymbol()', () => {
    it.each(['usd', 'USD', 'Usd'])('returns a virtual USD coin for "%s" (case-insensitive)', async (input) => {
      const result = await service.getCoinBySymbol(input);

      expect(result.id).toBe('USD-virtual');
      expect(result.symbol).toBe('USD');
      expect(result.name).toBe('US Dollar');
      expect(coinRepository.findOne).not.toHaveBeenCalled();
    });

    it('queries the database for non-USD symbols', async () => {
      const btcCoin = createTestCoin({ symbol: 'btc' });
      coinRepository.findOne.mockResolvedValue(btcCoin);

      const result = await service.getCoinBySymbol('BTC');

      expect(coinRepository.findOne).toHaveBeenCalledWith({
        where: expect.objectContaining({ symbol: 'btc', delistedAt: IsNull() }),
        relations: undefined
      });
      expect(result.symbol).toBe('btc');
    });

    it('throws CoinNotFoundException when fail=true and coin not found', async () => {
      coinRepository.findOne.mockResolvedValue(null);

      await expect(service.getCoinBySymbol('FAKE')).rejects.toThrow(CoinNotFoundException);
    });

    it('returns null when fail=false and coin not found', async () => {
      coinRepository.findOne.mockResolvedValue(null);

      const result = await service.getCoinBySymbol('FAKE', undefined, false);
      expect(result).toBeNull();
    });

    it('includes delisted coins when includeDelisted is true', async () => {
      const coin = createTestCoin({ symbol: 'btc' });
      coinRepository.findOne.mockResolvedValue(coin);
      await service.getCoinBySymbol('btc', undefined, true, true);
      const callArg = coinRepository.findOne.mock.calls[0][0] as FindOneOptions<Coin>;
      expect(callArg.where).not.toHaveProperty('delistedAt');
    });
  });

  // ===========================================================================
  // getCoinById()
  // ===========================================================================
  describe('getCoinById()', () => {
    it('returns the coin when found', async () => {
      const coin = createTestCoin({ id: 'abc' });
      coinRepository.findOne.mockResolvedValue(coin);

      const result = await service.getCoinById('abc');
      expect(coinRepository.findOne).toHaveBeenCalledWith({ where: { id: 'abc' }, relations: undefined });
      expect(result.id).toBe('abc');
    });

    it('throws CoinNotFoundException when not found', async () => {
      coinRepository.findOne.mockResolvedValue(null);

      await expect(service.getCoinById('missing')).rejects.toThrow(CoinNotFoundException);
    });
  });

  // ===========================================================================
  // getCoinsByIds()
  // ===========================================================================
  describe('getCoinsByIds()', () => {
    it('returns empty array for empty input', async () => {
      expect(await service.getCoinsByIds([])).toEqual([]);
      expect(coinRepository.find).not.toHaveBeenCalled();
    });

    it('deduplicates and filters invalid IDs', async () => {
      coinRepository.find.mockResolvedValue([createTestCoin({ id: 'a' })]);

      await service.getCoinsByIds(['a', 'a', '', '  ']);

      const callArgs = coinRepository.find.mock.calls[0][0] as any;
      // Should deduplicate 'a','a' → ['a'] and filter out '' and '  '
      expect(callArgs.where.id._value).toEqual(['a']);
    });

    it('returns empty array when all IDs are invalid', async () => {
      const result = await service.getCoinsByIds(['', '  ']);

      expect(result).toEqual([]);
      expect(coinRepository.find).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // getCoinsByIdsFiltered()
  // ===========================================================================
  describe('getCoinsByIdsFiltered()', () => {
    it('returns empty array for empty input', async () => {
      expect(await service.getCoinsByIdsFiltered([])).toEqual([]);
    });

    it('returns empty array when all IDs are invalid', async () => {
      expect(await service.getCoinsByIdsFiltered(['', '  '])).toEqual([]);
    });

    it('applies market cap and volume filters via query builder', async () => {
      const qb = mockQueryBuilder();
      const coins = [createTestCoin()];
      qb.getMany.mockResolvedValue(coins);
      coinRepository.createQueryBuilder.mockReturnValue(qb as any);

      const result = await service.getCoinsByIdsFiltered(['coin-1'], 500_000, 100_000);

      expect(qb.where).toHaveBeenCalledWith('coin.id IN (:...ids)', { ids: ['coin-1'] });
      expect(qb.andWhere).toHaveBeenCalledWith('coin.marketCap >= :minMarketCap', { minMarketCap: 500_000 });
      expect(qb.andWhere).toHaveBeenCalledWith('coin.totalVolume >= :minDailyVolume', { minDailyVolume: 100_000 });
      expect(qb.orderBy).toHaveBeenCalledWith('coin.marketCap', 'DESC');
      expect(result).toEqual(coins);
    });

    it('uses default thresholds when not specified', async () => {
      const qb = mockQueryBuilder();
      coinRepository.createQueryBuilder.mockReturnValue(qb as any);

      await service.getCoinsByIdsFiltered(['coin-1']);

      expect(qb.andWhere).toHaveBeenCalledWith('coin.marketCap >= :minMarketCap', { minMarketCap: 100_000_000 });
      expect(qb.andWhere).toHaveBeenCalledWith('coin.totalVolume >= :minDailyVolume', { minDailyVolume: 1_000_000 });
    });

    it('excludes delisted coins by default', async () => {
      const qb = mockQueryBuilder();
      coinRepository.createQueryBuilder.mockReturnValue(qb as any);

      await service.getCoinsByIdsFiltered(['id1']);
      expect(qb.andWhere).toHaveBeenCalledWith('coin.delistedAt IS NULL');
    });

    it('includes delisted coins when includeDelisted is true but still applies quality filters', async () => {
      const qb = mockQueryBuilder();
      coinRepository.createQueryBuilder.mockReturnValue(qb as any);

      await service.getCoinsByIdsFiltered(['id1'], 100_000_000, 1_000_000, { includeDelisted: true });

      const delistedCalls = qb.andWhere.mock.calls.filter((call: unknown[]) => call[0] === 'coin.delistedAt IS NULL');
      expect(delistedCalls).toHaveLength(0);
      // includeDelisted only relaxes the delisted check — quality filters must still apply
      expect(qb.andWhere).toHaveBeenCalledWith('coin.marketCap >= :minMarketCap', { minMarketCap: 100_000_000 });
      expect(qb.andWhere).toHaveBeenCalledWith('coin.totalVolume >= :minDailyVolume', { minDailyVolume: 1_000_000 });
      expect(qb.andWhere).toHaveBeenCalledWith('coin.currentPrice IS NOT NULL');
    });

    it('omits currentPrice IS NOT NULL clause when skipCurrentPriceCheck is true', async () => {
      const qb = mockQueryBuilder();
      coinRepository.createQueryBuilder.mockReturnValue(qb as any);

      await service.getCoinsByIdsFiltered(['id1'], 100_000_000, 1_000_000, { skipCurrentPriceCheck: true });

      const currentPriceCalls = qb.andWhere.mock.calls.filter(
        (call: unknown[]) => call[0] === 'coin.currentPrice IS NOT NULL'
      );
      expect(currentPriceCalls).toHaveLength(0);
      // Quality filters still applied
      expect(qb.andWhere).toHaveBeenCalledWith('coin.marketCap >= :minMarketCap', { minMarketCap: 100_000_000 });
      expect(qb.andWhere).toHaveBeenCalledWith('coin.totalVolume >= :minDailyVolume', { minDailyVolume: 1_000_000 });
    });
  });

  // ===========================================================================
  // getMultipleCoinsBySymbol()
  // ===========================================================================
  describe('getMultipleCoinsBySymbol()', () => {
    it('returns virtual USD coin when USD is in the list', async () => {
      coinRepository.find.mockResolvedValue([]);

      const result = await service.getMultipleCoinsBySymbol(['USD']);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('USD-virtual');
    });

    it('queries DB for non-USD symbols and includes USD when both requested', async () => {
      const btc = createTestCoin({ symbol: 'btc' });
      coinRepository.find.mockResolvedValue([btc]);

      const result = await service.getMultipleCoinsBySymbol(['BTC', 'USD']);

      // DB query should exclude USD
      const callArgs = coinRepository.find.mock.calls[0][0] as any;
      expect(callArgs.where.symbol._value).toEqual(['btc']);
      // Result should include both
      expect(result).toHaveLength(2);
      expect(result.map((c) => c.symbol)).toEqual(expect.arrayContaining(['btc', 'USD']));
    });

    it('skips DB query when only USD is requested', async () => {
      const result = await service.getMultipleCoinsBySymbol(['USD']);

      expect(coinRepository.find).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('USD-virtual');
    });

    it('logs warning for symbols not found in DB', async () => {
      coinRepository.find.mockResolvedValue([]);
      const warnSpy = jest.spyOn(service['logger'], 'warn');

      await service.getMultipleCoinsBySymbol(['FAKE', 'NOPE']);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('fake'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('nope'));
    });

    it('does not log warning when all symbols are found', async () => {
      coinRepository.find.mockResolvedValue([createTestCoin({ symbol: 'btc' })]);
      const warnSpy = jest.spyOn(service['logger'], 'warn');

      await service.getMultipleCoinsBySymbol(['BTC']);

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('excludes delisted coins by default', async () => {
      coinRepository.find.mockResolvedValue([]);
      await service.getMultipleCoinsBySymbol(['btc', 'eth']);
      const callArg = coinRepository.find.mock.calls[0][0] as FindManyOptions<Coin>;
      expect(callArg.where).toEqual(expect.objectContaining({ delistedAt: IsNull() }));
    });

    it('includes delisted coins when includeDelisted is true', async () => {
      coinRepository.find.mockResolvedValue([]);
      await service.getMultipleCoinsBySymbol(['btc', 'eth'], undefined, { includeDelisted: true });
      const callArg = coinRepository.find.mock.calls[0][0] as FindManyOptions<Coin>;
      expect(callArg.where).not.toHaveProperty('delistedAt');
    });
  });

  // ===========================================================================
  // getCoins()
  // ===========================================================================
  describe('getCoins()', () => {
    it('returns coins ordered by market rank with null props stripped', async () => {
      const coin = createTestCoin({ marketCap: null as unknown as undefined });
      coinRepository.find.mockResolvedValue([coin]);

      const result = await service.getCoins();

      expect(coinRepository.find).toHaveBeenCalledWith({
        where: { delistedAt: IsNull() },
        order: { marketRank: 'ASC' }
      });
      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty('marketCap');
    });

    it('excludes delisted coins by default', async () => {
      coinRepository.find.mockResolvedValue([]);
      await service.getCoins();
      const callArg = coinRepository.find.mock.calls[0][0] as FindManyOptions<Coin>;
      expect(callArg.where).toEqual(expect.objectContaining({ delistedAt: IsNull() }));
    });

    it('includes delisted coins when includeDelisted is true', async () => {
      coinRepository.find.mockResolvedValue([]);
      await service.getCoins({ includeDelisted: true });
      const callArg = coinRepository.find.mock.calls[0][0] as FindManyOptions<Coin>;
      expect(callArg.where).toEqual({});
    });
  });

  // ===========================================================================
  // create()
  // ===========================================================================
  describe('create()', () => {
    it('inserts a new coin when slug does not exist', async () => {
      coinRepository.findOne.mockResolvedValue(null);
      const dto = { slug: 'ethereum', name: 'Ethereum', symbol: 'ETH' };

      await service.create(dto as any);

      expect(coinRepository.insert).toHaveBeenCalledWith(dto);
    });

    it('skips insert when coin with slug already exists', async () => {
      coinRepository.findOne.mockResolvedValue(createTestCoin({ slug: 'bitcoin' }));

      await service.create({ slug: 'bitcoin', name: 'Bitcoin', symbol: 'BTC' } as any);

      expect(coinRepository.insert).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // createMany()
  // ===========================================================================
  describe('createMany()', () => {
    it('inserts only coins with new slugs', async () => {
      coinRepository.find.mockResolvedValue([createTestCoin({ slug: 'bitcoin' })]);
      const coins = [
        { slug: 'bitcoin', name: 'Bitcoin', symbol: 'BTC' },
        { slug: 'ethereum', name: 'Ethereum', symbol: 'ETH' }
      ];

      await service.createMany(coins as any);

      expect(coinRepository.insert).toHaveBeenCalledWith([coins[1]]);
    });

    it('skips insert when all coins already exist', async () => {
      coinRepository.find.mockResolvedValue([createTestCoin({ slug: 'bitcoin' })]);

      await service.createMany([{ slug: 'bitcoin', name: 'Bitcoin', symbol: 'BTC' }] as any);

      expect(coinRepository.insert).not.toHaveBeenCalled();
    });

    it('short-circuits without inserting when newCoins resolves to empty', async () => {
      coinRepository.find.mockResolvedValue([
        createTestCoin({ slug: 'bitcoin' }),
        createTestCoin({ slug: 'ethereum' })
      ]);

      await service.createMany([
        { slug: 'bitcoin', name: 'Bitcoin', symbol: 'BTC' },
        { slug: 'ethereum', name: 'Ethereum', symbol: 'ETH' }
      ] as any);

      expect(coinRepository.insert).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // update()
  // ===========================================================================
  describe('update()', () => {
    it('merges DTO into existing coin and saves', async () => {
      const existing = createTestCoin({ id: 'c1', name: 'Bitcoin' });
      coinRepository.findOne.mockResolvedValue(existing);
      coinRepository.save.mockResolvedValue(existing);

      await service.update('c1', { name: 'Bitcoin Updated' } as any);

      expect(coinRepository.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', name: 'Bitcoin Updated' }));
    });

    it('throws CoinNotFoundException if coin does not exist', async () => {
      coinRepository.findOne.mockResolvedValue(null);

      await expect(service.update('missing', {} as any)).rejects.toThrow(CoinNotFoundException);
    });
  });

  // ===========================================================================
  // updateCurrentPrice()
  // ===========================================================================
  describe('updateCurrentPrice()', () => {
    it('updates only the currentPrice field', async () => {
      await service.updateCurrentPrice('c1', 42000);

      expect(coinRepository.update).toHaveBeenCalledWith('c1', { currentPrice: 42000 });
    });
  });

  // ===========================================================================
  // markSnapshotBackfillComplete()
  // ===========================================================================
  describe('markSnapshotBackfillComplete()', () => {
    it('stamps snapshotBackfillCompletedAt with the current time', async () => {
      await service.markSnapshotBackfillComplete('c1');

      expect(coinRepository.update).toHaveBeenCalledWith('c1', {
        snapshotBackfillCompletedAt: expect.any(Date)
      });
    });
  });

  // ===========================================================================
  // clearRank()
  // ===========================================================================
  describe('clearRank()', () => {
    it('sets geckoRank to null for all coins', async () => {
      const qb = mockQueryBuilder();
      coinRepository.createQueryBuilder.mockReturnValue(qb as any);

      await service.clearRank();

      expect(qb.update).toHaveBeenCalled();
      expect(qb.set).toHaveBeenCalledWith({ geckoRank: null });
      expect(qb.execute).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Soft-delete: remove() and removeMany()
  // ===========================================================================
  describe('remove() soft-delete', () => {
    it('sets delistedAt instead of deleting', async () => {
      const coin = createTestCoin({ id: 'abc' });
      coinRepository.findOne.mockResolvedValue(coin);
      coinRepository.save.mockResolvedValue({ ...coin, delistedAt: new Date() } as any);

      await service.remove('abc');

      expect(coinRepository.save).toHaveBeenCalledWith(expect.objectContaining({ delistedAt: expect.any(Date) }));
      expect(coinRepository.delete).not.toHaveBeenCalled();
    });

    it('returns the coin without re-saving when it is already delisted', async () => {
      const alreadyDelistedAt = new Date('2023-01-01');
      const coin = createTestCoin({ id: 'abc', delistedAt: alreadyDelistedAt });
      coinRepository.findOne.mockResolvedValue(coin);

      const result = await service.remove('abc');

      expect(coinRepository.save).not.toHaveBeenCalled();
      expect(coinRepository.delete).not.toHaveBeenCalled();
      expect(result.delistedAt).toBe(alreadyDelistedAt);
    });
  });

  describe('removeMany() soft-delete', () => {
    let mockQb: Record<string, jest.Mock>;

    beforeEach(() => {
      mockQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 2 })
      };
      coinRepository.createQueryBuilder.mockReturnValue(mockQb as any);
    });

    it('sets delistedAt instead of calling delete', async () => {
      await service.removeMany(['id1', 'id2']);

      expect(mockQb.update).toHaveBeenCalled();
      expect(mockQb.set).toHaveBeenCalledWith({ delistedAt: expect.any(Date) });
      expect(mockQb.where).toHaveBeenCalledWith('id IN (:...ids)', { ids: ['id1', 'id2'] });
      expect(mockQb.andWhere).toHaveBeenCalledWith('delistedAt IS NULL');
      expect(mockQb.execute).toHaveBeenCalled();
      expect(coinRepository.delete).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // relistCoin()
  // ===========================================================================
  describe('relistCoin()', () => {
    it('sets delistedAt to null', async () => {
      await service.relistCoin('abc');
      expect(coinRepository.update).toHaveBeenCalledWith('abc', { delistedAt: null });
    });
  });

  // ===========================================================================
  // relistMany()
  // ===========================================================================
  describe('relistMany()', () => {
    let mockQb: Record<string, jest.Mock>;

    beforeEach(() => {
      mockQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 2 })
      };
      coinRepository.createQueryBuilder.mockReturnValue(mockQb as any);
    });

    it('clears delistedAt for multiple coins', async () => {
      await service.relistMany(['id1', 'id2']);

      expect(mockQb.update).toHaveBeenCalled();
      expect(mockQb.set).toHaveBeenCalledWith({ delistedAt: null });
      expect(mockQb.where).toHaveBeenCalledWith('id IN (:...ids)', { ids: ['id1', 'id2'] });
      expect(mockQb.andWhere).toHaveBeenCalledWith('delistedAt IS NOT NULL');
      expect(mockQb.execute).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // getDelistedCoins()
  // ===========================================================================
  describe('getDelistedCoins()', () => {
    it('returns only coins where delistedAt is not null', async () => {
      const delistedCoin = createTestCoin({ id: 'del1', delistedAt: new Date() });
      coinRepository.find.mockResolvedValue([delistedCoin]);

      const result = await service.getDelistedCoins();

      expect(coinRepository.find).toHaveBeenCalledWith({ where: { delistedAt: expect.anything() } });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('del1');
    });
  });

  // ===========================================================================
  // hardRemoveMany()
  // ===========================================================================
  describe('hardRemoveMany()', () => {
    it('calls actual delete', async () => {
      await service.hardRemoveMany(['id1', 'id2']);
      expect(coinRepository.delete).toHaveBeenCalledWith({ id: In(['id1', 'id2']) });
    });
  });

  // ===========================================================================
  // getCoinsByIdsFilteredAtDate()
  // ===========================================================================
  describe('getCoinsByIdsFilteredAtDate()', () => {
    const testDate = new Date('2024-06-15');

    it('delegates to snapshotService and preserves historical order for qualifying IDs', async () => {
      const qualifiedIds = ['eth-id', 'btc-id']; // historical market cap order
      snapshotService.getQualifiedCoinIdsAtDate.mockResolvedValue({ qualifiedIds, hasSnapshots: true });
      const coins = [createTestCoin({ id: 'btc-id' }), createTestCoin({ id: 'eth-id' })];
      coinRepository.find.mockResolvedValue(coins);

      const result = await service.getCoinsByIdsFilteredAtDate(['btc-id', 'eth-id', 'doge-id'], testDate);

      expect(snapshotService.getQualifiedCoinIdsAtDate).toHaveBeenCalledWith(
        ['btc-id', 'eth-id', 'doge-id'],
        testDate,
        100_000_000,
        1_000_000
      );
      expect(coinRepository.find).toHaveBeenCalledWith({
        where: { id: In(qualifiedIds) }
      });
      // Order should match qualifiedIds (historical), not current marketCap
      expect(result.coins.map((c) => c.id)).toEqual(['eth-id', 'btc-id']);
      expect(result.usedHistoricalData).toBe(true);
    });

    it('returns empty coins when snapshots exist but none qualify', async () => {
      snapshotService.getQualifiedCoinIdsAtDate.mockResolvedValue({ qualifiedIds: [], hasSnapshots: true });

      const result = await service.getCoinsByIdsFilteredAtDate(['btc-id'], testDate);

      expect(result).toEqual({ coins: [], usedHistoricalData: true });
      expect(coinRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('falls back to getCoinsByIdsFiltered with relaxed options when no snapshots exist at all', async () => {
      snapshotService.getQualifiedCoinIdsAtDate.mockResolvedValue({ qualifiedIds: [], hasSnapshots: false });

      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([createTestCoin({ id: 'btc-id' })])
      };
      coinRepository.createQueryBuilder.mockReturnValue(mockQb as any);

      const result = await service.getCoinsByIdsFilteredAtDate(['btc-id'], testDate);

      expect(coinRepository.createQueryBuilder).toHaveBeenCalled();
      expect(result.coins).toHaveLength(1);
      expect(result.usedHistoricalData).toBe(false);

      // Backtest fallback must NOT exclude coins for stale currentPrice or being delisted —
      // tradeability is verified separately via OHLC candles in this code path.
      const andWhereClauses = mockQb.andWhere.mock.calls.map((call: unknown[]) => String(call[0]));
      expect(andWhereClauses).not.toContain('coin.currentPrice IS NOT NULL');
      expect(andWhereClauses).not.toContain('coin.delistedAt IS NULL');
      // But quality filters still apply
      expect(andWhereClauses).toContain('coin.marketCap >= :minMarketCap');
      expect(andWhereClauses).toContain('coin.totalVolume >= :minDailyVolume');
    });

    it('returns empty array for empty coinIds input', async () => {
      const result = await service.getCoinsByIdsFilteredAtDate([], testDate);

      expect(result).toEqual({ coins: [], usedHistoricalData: false });
      expect(snapshotService.getQualifiedCoinIdsAtDate).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Empty array guard clauses
  // ===========================================================================
  describe('empty array guard clauses', () => {
    it.each([
      ['removeMany', () => service.removeMany([])],
      ['relistMany', () => service.relistMany([])],
      ['hardRemoveMany', () => service.hardRemoveMany([])]
    ])('%s is a no-op for empty array', async (_name, fn) => {
      await fn();
      expect(coinRepository.createQueryBuilder).not.toHaveBeenCalled();
      expect(coinRepository.delete).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // getCoinsWithCurrentPrices()
  // ===========================================================================
  describe('getCoinsWithCurrentPrices()', () => {
    it('selects only price-relevant fields ordered by name', async () => {
      coinRepository.find.mockResolvedValue([createTestCoin()]);

      await service.getCoinsWithCurrentPrices();

      expect(coinRepository.find).toHaveBeenCalledWith({
        select: ['id', 'slug', 'name', 'symbol', 'image', 'currentPrice'],
        where: { delistedAt: IsNull() },
        order: { name: 'ASC' }
      });
    });
  });

  // ===========================================================================
  // getCoinBySlug()
  // ===========================================================================
  describe('getCoinBySlug()', () => {
    it('queries by slug', async () => {
      const coin = createTestCoin({ slug: 'ethereum' });
      coinRepository.findOne.mockResolvedValue(coin);

      const result = await service.getCoinBySlug('ethereum');

      expect(coinRepository.findOne).toHaveBeenCalledWith({ where: { slug: 'ethereum' } });
      expect(result?.slug).toBe('ethereum');
    });

    it('returns null when no coin matches the slug (does not throw)', async () => {
      coinRepository.findOne.mockResolvedValue(null);

      const result = await service.getCoinBySlug('missing-coin');

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // getCoinsBySymbols()
  // ===========================================================================
  describe('getCoinsBySymbols()', () => {
    it('returns [] for an empty set without hitting the DB', async () => {
      const result = await service.getCoinsBySymbols(new Set());

      expect(result).toEqual([]);
      expect(coinRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('lowercases the input set and filters delisted coins, ordered by marketRank', async () => {
      const qb = mockQueryBuilder();
      qb.getMany.mockResolvedValue([createTestCoin({ symbol: 'btc' })]);
      coinRepository.createQueryBuilder.mockReturnValue(qb as any);

      await service.getCoinsBySymbols(new Set(['BTC', 'Eth']));

      expect(qb.where).toHaveBeenCalledWith('LOWER(coin.symbol) IN (:...symbols)', {
        symbols: ['btc', 'eth']
      });
      expect(qb.andWhere).toHaveBeenCalledWith('coin.delistedAt IS NULL');
      expect(qb.orderBy).toHaveBeenCalledWith('coin.marketRank', 'ASC', 'NULLS LAST');
    });
  });

  // ===========================================================================
  // getEligibleCoinsForMapping()
  // ===========================================================================
  describe('getEligibleCoinsForMapping()', () => {
    it('applies the full selection eligibility filter (mcap, volume, price, delisted, stablecoins)', async () => {
      const qb = mockQueryBuilder();
      coinRepository.createQueryBuilder.mockReturnValue(qb as any);

      await service.getEligibleCoinsForMapping();

      const clauses = [
        ...qb.where.mock.calls.map((call: unknown[]) => String(call[0])),
        ...qb.andWhere.mock.calls.map((call: unknown[]) => String(call[0]))
      ];
      expect(clauses).toContain('coin.delistedAt IS NULL');
      expect(clauses).toContain('coin.currentPrice IS NOT NULL');
      expect(clauses).toContain('coin.marketCap >= :minMarketCap');
      expect(clauses).toContain('coin.totalVolume >= :minDailyVolume');
      expect(clauses).toContain('UPPER(coin.symbol) NOT IN (:...stablecoins)');
      expect(qb.orderBy).toHaveBeenCalledWith('coin.marketRank', 'ASC', 'NULLS LAST');
    });

    it('uses the same MIN_MARKET_CAP and MIN_DAILY_VOLUME as backtest filtering', async () => {
      const qb = mockQueryBuilder();
      coinRepository.createQueryBuilder.mockReturnValue(qb as any);

      await service.getEligibleCoinsForMapping();

      expect(qb.andWhere).toHaveBeenCalledWith('coin.marketCap >= :minMarketCap', { minMarketCap: 100_000_000 });
      expect(qb.andWhere).toHaveBeenCalledWith('coin.totalVolume >= :minDailyVolume', { minDailyVolume: 1_000_000 });
    });

    it('intersects with the provided baseSymbols set (case-insensitive)', async () => {
      const qb = mockQueryBuilder();
      coinRepository.createQueryBuilder.mockReturnValue(qb as any);

      await service.getEligibleCoinsForMapping(new Set(['BTC', 'Eth']));

      expect(qb.andWhere).toHaveBeenCalledWith('LOWER(coin.symbol) IN (:...symbols)', {
        symbols: ['btc', 'eth']
      });
    });

    it('returns [] without hitting the DB when baseSymbols is an empty set', async () => {
      const result = await service.getEligibleCoinsForMapping(new Set());

      expect(result).toEqual([]);
      expect(coinRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('skips the symbol intersection when baseSymbols is undefined', async () => {
      const qb = mockQueryBuilder();
      coinRepository.createQueryBuilder.mockReturnValue(qb as any);

      await service.getEligibleCoinsForMapping();

      const symbolFilter = qb.andWhere.mock.calls.find(
        (call: unknown[]) => String(call[0]) === 'LOWER(coin.symbol) IN (:...symbols)'
      );
      expect(symbolFilter).toBeUndefined();
    });
  });

  // ===========================================================================
  // getCoinsByRiskLevelValue()
  // ===========================================================================
  // Behavior of the underlying selectCoinsByRiskLevel function lives in
  // coin-risk-selection.spec.ts; this wrapper test only verifies that the
  // service forwards level, take, and userExchangeIds through correctly.
  describe('getCoinsByRiskLevelValue()', () => {
    it('forwards level, take, and userExchangeIds to selectCoinsByRiskLevel', async () => {
      const qb = mockQueryBuilder();
      qb.getMany.mockResolvedValue([createTestCoin()]);
      coinRepository.createQueryBuilder.mockReturnValue(qb as any);

      await service.getCoinsByRiskLevelValue(2, 4, ['ex-x']);

      // Oversamples by SHORTLIST_MULTIPLIER (3) → take * 3 = 12
      expect(qb.take).toHaveBeenCalledWith(12);
      const userExchangeClause = qb.andWhere.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('userExchangeIds')
      );
      expect(userExchangeClause?.[1]).toEqual({ userExchangeIds: ['ex-x'], freshnessHours: 24 });
    });
  });

  // ===========================================================================
  // getCoinsByRiskLevel()
  // ===========================================================================
  describe('getCoinsByRiskLevel()', () => {
    it('extracts risk level from user and forwards userExchangeIds', async () => {
      const qb = mockQueryBuilder();
      qb.getMany.mockResolvedValue([createTestCoin()]);
      coinRepository.createQueryBuilder.mockReturnValue(qb as any);
      const user = { coinRisk: { level: 1 } } as any;

      await service.getCoinsByRiskLevel(user, 5, ['ex-a']);

      // Oversample by SHORTLIST_MULTIPLIER (3): take=5 → shortlistSize=15
      expect(qb.take).toHaveBeenCalledWith(15);
      const matching = qb.andWhere.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('userExchangeIds')
      );
      expect(matching?.[1]).toEqual({ userExchangeIds: ['ex-a'], freshnessHours: 24 });
    });

    it('defaults to level 3 when user has no risk', async () => {
      const qb = mockQueryBuilder();
      qb.getMany.mockResolvedValue([createTestCoin()]);
      coinRepository.createQueryBuilder.mockReturnValue(qb as any);
      const user = { coinRisk: null } as any;

      await service.getCoinsByRiskLevel(user);

      // Level 3 should apply its momentum scoring
      const orderExpr = String(qb.orderBy.mock.calls[0][0]);
      expect(orderExpr).toContain('priceChangePercentage7d');
    });
  });

  // ===========================================================================
  // isCoinTradableOnUserExchanges()
  // ===========================================================================
  describe('isCoinTradableOnUserExchanges()', () => {
    const mockTradeableQb = (existing: { id: string } | null) => {
      const qb: Record<string, jest.Mock> = {};
      qb.select = jest.fn().mockReturnValue(qb);
      qb.where = jest.fn().mockReturnValue(qb);
      qb.andWhere = jest.fn().mockReturnValue(qb);
      qb.getOne = jest.fn().mockResolvedValue(existing);
      coinRepository.createQueryBuilder.mockReturnValue(qb as any);
      return qb;
    };

    it('returns false without hitting the DB when userExchangeIds is empty', async () => {
      const result = await service.isCoinTradableOnUserExchanges('coin-1', []);
      expect(result).toBe(false);
      expect(coinRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('returns true when the EXISTS sub-query matches an active symbol map + recent OHLC', async () => {
      const qb = mockTradeableQb({ id: 'coin-1' });

      const result = await service.isCoinTradableOnUserExchanges('coin-1', ['ex-a']);

      expect(result).toBe(true);
      const existsClause = qb.andWhere.mock.calls[0];
      const sql = String(existsClause?.[0] ?? '');
      expect(sql).toContain('exchange_symbol_map');
      expect(sql).toContain('ohlc_candles');
      expect(sql).toContain(':freshnessHours');
      expect(sql).toContain('oc.volume > 0');
      expect(existsClause?.[1]).toEqual({ userExchangeIds: ['ex-a'], freshnessHours: 24 });
    });

    it('returns false when the coin has no recent OHLC on the user exchange', async () => {
      mockTradeableQb(null);

      const result = await service.isCoinTradableOnUserExchanges('coin-1', ['ex-a']);

      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // getPopularCoins()
  // ===========================================================================
  describe('getPopularCoins()', () => {
    it('returns coins with non-null market data ordered by market cap', async () => {
      coinRepository.find.mockResolvedValue([createTestCoin()]);

      await service.getPopularCoins(15);

      expect(coinRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { marketCap: 'DESC' },
          take: 15
        })
      );
    });

    it('defaults to 20 coins', async () => {
      coinRepository.find.mockResolvedValue([]);

      await service.getPopularCoins();

      expect(coinRepository.find).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }));
    });
  });
});
