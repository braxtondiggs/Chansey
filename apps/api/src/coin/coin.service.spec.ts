import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { FindManyOptions, FindOneOptions, In, IsNull, Repository } from 'typeorm';

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
        }
      ]
    }).compile();

    service = module.get<CoinService>(CoinService);
    coinRepository = module.get(getRepositoryToken(Coin));
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

    it('includes delisted coins when includeDelisted is true', async () => {
      const qb = mockQueryBuilder();
      coinRepository.createQueryBuilder.mockReturnValue(qb as any);

      await service.getCoinsByIdsFiltered(['id1'], 100_000_000, 1_000_000, { includeDelisted: true });
      const delistedCalls = qb.andWhere.mock.calls.filter(
        (call: unknown[]) => call[0] === 'coin.delistedAt IS NULL'
      );
      expect(delistedCalls).toHaveLength(0);
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
  });

  // ===========================================================================
  // getCoinsByRiskLevelValue()
  // ===========================================================================
  describe('getCoinsByRiskLevelValue()', () => {
    it('returns highest-volume coins for risk level 1', async () => {
      coinRepository.find.mockResolvedValue([createTestCoin()]);

      await service.getCoinsByRiskLevelValue(1, 5);

      expect(coinRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { totalVolume: 'DESC' },
          take: 5
        })
      );
    });

    it('returns lowest gecko-rank coins for risk level 5', async () => {
      coinRepository.find.mockResolvedValue([createTestCoin()]);

      await service.getCoinsByRiskLevelValue(5, 5);

      expect(coinRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { geckoRank: 'ASC' },
          take: 5
        })
      );
    });

    it('uses composite query builder for risk levels 2-4', async () => {
      const qb = mockQueryBuilder();
      coinRepository.createQueryBuilder.mockReturnValue(qb as any);

      await service.getCoinsByRiskLevelValue(3, 10);

      expect(coinRepository.createQueryBuilder).toHaveBeenCalledWith('coin');
      expect(qb.where).toHaveBeenCalledWith('coin.totalVolume IS NOT NULL');
      expect(qb.take).toHaveBeenCalledWith(10);
      expect(qb.getMany).toHaveBeenCalled();
    });

    it.each([
      [0, 'totalVolume'],
      [-1, 'totalVolume'],
      [6, 'geckoRank'],
      [99, 'geckoRank']
    ])('clamps out-of-range level %d to valid range', async (level, expectedOrderKey) => {
      coinRepository.find.mockResolvedValue([]);

      await service.getCoinsByRiskLevelValue(level);

      if (coinRepository.find.mock.calls.length > 0) {
        const callArgs = coinRepository.find.mock.calls[0][0] as any;
        expect(callArgs.order).toHaveProperty(expectedOrderKey);
      }
    });

    it('defaults NaN level to 3 (moderate)', async () => {
      const qb = mockQueryBuilder();
      coinRepository.createQueryBuilder.mockReturnValue(qb as any);

      await service.getCoinsByRiskLevelValue(NaN);

      // Level 3 uses query builder (levels 2-4)
      expect(coinRepository.createQueryBuilder).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // getCoinsByRiskLevel()
  // ===========================================================================
  describe('getCoinsByRiskLevel()', () => {
    it('extracts risk level from user and delegates', async () => {
      coinRepository.find.mockResolvedValue([]);
      const user = { coinRisk: { level: 1 } } as any;

      await service.getCoinsByRiskLevel(user, 5);

      expect(coinRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { totalVolume: 'DESC' },
          take: 5
        })
      );
    });

    it('defaults to level 3 when user has no risk', async () => {
      const qb = mockQueryBuilder();
      coinRepository.createQueryBuilder.mockReturnValue(qb as any);
      const user = { coinRisk: null } as any;

      await service.getCoinsByRiskLevel(user);

      // Level 3 uses query builder
      expect(coinRepository.createQueryBuilder).toHaveBeenCalled();
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
