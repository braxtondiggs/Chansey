import { In, ObjectLiteral, Repository } from 'typeorm';

import { ExchangeSymbolMapService } from './exchange-symbol-map.service';

import { ExchangeSymbolMap } from '../exchange-symbol-map.entity';

type MockRepo<T extends ObjectLiteral> = jest.Mocked<Repository<T>>;

const createQueryBuilder = () => ({
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
  execute: jest.fn()
});

describe('ExchangeSymbolMapService', () => {
  let service: ExchangeSymbolMapService;
  let symbolMapRepository: MockRepo<ExchangeSymbolMap>;

  beforeEach(() => {
    symbolMapRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      update: jest.fn(),
      increment: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn()
    } as unknown as MockRepo<ExchangeSymbolMap>;

    service = new ExchangeSymbolMapService(symbolMapRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('upsertSymbolMap', () => {
    const mapping = { coinId: 'btc', exchangeId: 'ex-1', symbol: 'BTC/USD' };

    it('updates existing mapping and merges fields', async () => {
      const existing = { id: 'map-1', coinId: 'btc', exchangeId: 'ex-1' } as ExchangeSymbolMap;
      symbolMapRepository.findOne.mockResolvedValue(existing);

      const result = await service.upsertSymbolMap(mapping);

      expect(symbolMapRepository.findOne).toHaveBeenCalledWith({ where: { coinId: 'btc' } });
      expect(symbolMapRepository.update).toHaveBeenCalledWith(existing.id, mapping);
      expect(result).toEqual({ ...existing, symbol: 'BTC/USD' });
    });

    it('creates new mapping when none exists', async () => {
      symbolMapRepository.findOne.mockResolvedValue(null);
      const created = { ...mapping } as ExchangeSymbolMap;
      symbolMapRepository.create.mockReturnValue(created);
      symbolMapRepository.save.mockResolvedValue({ ...created, id: 'map-2' } as ExchangeSymbolMap);

      const result = await service.upsertSymbolMap(mapping);

      expect(symbolMapRepository.create).toHaveBeenCalledWith(mapping);
      expect(symbolMapRepository.save).toHaveBeenCalledWith(created);
      expect(result.id).toBe('map-2');
    });
  });

  describe('getActiveSymbolMaps', () => {
    it('includes exchangeId in where clause when provided', async () => {
      symbolMapRepository.find.mockResolvedValue([]);

      await service.getActiveSymbolMaps('ex-1');

      expect(symbolMapRepository.find).toHaveBeenCalledWith({
        where: { isActive: true, exchangeId: 'ex-1' },
        order: { priority: 'ASC' },
        relations: ['coin', 'exchange']
      });
    });

    it('omits exchangeId from where clause when not provided', async () => {
      symbolMapRepository.find.mockResolvedValue([]);

      await service.getActiveSymbolMaps();

      expect(symbolMapRepository.find).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { priority: 'ASC' },
        relations: ['coin', 'exchange']
      });
    });
  });

  describe('getSymbolMapsForCoins', () => {
    it('returns empty array without querying for empty input', async () => {
      const result = await service.getSymbolMapsForCoins([]);

      expect(result).toEqual([]);
      expect(symbolMapRepository.find).not.toHaveBeenCalled();
    });

    it('queries with In() operator for provided coin IDs', async () => {
      symbolMapRepository.find.mockResolvedValue([]);

      await service.getSymbolMapsForCoins(['btc', 'eth']);

      expect(symbolMapRepository.find).toHaveBeenCalledWith({
        where: {
          coinId: In(['btc', 'eth']),
          isActive: true
        },
        order: { priority: 'ASC' },
        relations: ['coin', 'exchange']
      });
    });
  });

  it('markSyncSuccess resets failure count and sets lastSyncAt', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-03T00:00:00Z'));

    await service.markSyncSuccess('map-1');

    expect(symbolMapRepository.update).toHaveBeenCalledWith('map-1', {
      failureCount: 0,
      lastSyncAt: new Date('2024-01-03T00:00:00Z')
    });

    jest.useRealTimers();
  });

  describe('deactivateFailedMappings', () => {
    it('returns affected count from query result', async () => {
      const qb = createQueryBuilder();
      qb.execute.mockResolvedValue({ affected: 3 });
      (symbolMapRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const result = await service.deactivateFailedMappings(24);

      expect(result).toBe(3);
      expect(qb.set).toHaveBeenCalledWith({ isActive: false });
      expect(qb.where).toHaveBeenCalledWith('lastSyncAt IS NULL');
      expect(qb.andWhere).toHaveBeenCalledWith('failureCount >= :minFailures', { minFailures: 24 });
    });

    it('returns 0 when affected is undefined', async () => {
      const qb = createQueryBuilder();
      qb.execute.mockResolvedValue({ affected: undefined });
      (symbolMapRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const result = await service.deactivateFailedMappings(24);

      expect(result).toBe(0);
    });
  });

  describe('getStaleCoins', () => {
    it('queries with cutoff date based on threshold hours', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2024-01-03T12:00:00Z'));
      const qb = createQueryBuilder();
      const mappings = [{ coinId: 'btc' }] as ExchangeSymbolMap[];
      qb.getMany.mockResolvedValue(mappings);
      (symbolMapRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const result = await service.getStaleCoins(2);

      expect(result).toEqual(mappings);
      expect(qb.andWhere).toHaveBeenCalledWith('(mapping.lastSyncAt IS NULL OR mapping.lastSyncAt < :cutoffDate)', {
        cutoffDate: new Date('2024-01-03T10:00:00Z')
      });

      jest.useRealTimers();
    });
  });

  describe('getLastSyncTime', () => {
    it('returns lastSyncAt date when found', async () => {
      const syncDate = new Date('2024-01-02T01:00:00Z');
      symbolMapRepository.findOne.mockResolvedValue({ lastSyncAt: syncDate } as any);

      const result = await service.getLastSyncTime();

      expect(result).toEqual(syncDate);
      expect(symbolMapRepository.findOne).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { lastSyncAt: 'DESC' },
        select: ['lastSyncAt']
      });
    });

    it('returns null when no active mappings exist', async () => {
      symbolMapRepository.findOne.mockResolvedValue(null);

      const result = await service.getLastSyncTime();

      expect(result).toBeNull();
    });
  });
});
