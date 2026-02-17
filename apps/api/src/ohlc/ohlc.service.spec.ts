import { ObjectLiteral, Repository } from 'typeorm';

import { ExchangeSymbolMap } from './exchange-symbol-map.entity';
import { OHLCCandle } from './ohlc-candle.entity';
import { OHLCService } from './ohlc.service';

type MockRepo<T extends ObjectLiteral> = jest.Mocked<Repository<T>>;

const createQueryBuilder = () => ({
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  addOrderBy: jest.fn().mockReturnThis(),
  distinctOn: jest.fn().mockReturnThis(),
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
  getRawMany: jest.fn(),
  getRawOne: jest.fn(),
  getOne: jest.fn()
});

describe('OHLCService', () => {
  let service: OHLCService;
  let ohlcRepository: MockRepo<OHLCCandle>;
  let symbolMapRepository: MockRepo<ExchangeSymbolMap>;

  beforeEach(() => {
    ohlcRepository = {
      insert: jest.fn(),
      upsert: jest.fn(),
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
      increment: jest.fn()
    } as unknown as MockRepo<OHLCCandle>;

    symbolMapRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      update: jest.fn(),
      increment: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn()
    } as unknown as MockRepo<ExchangeSymbolMap>;

    service = new OHLCService(ohlcRepository, symbolMapRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('saveCandles skips insert when empty', async () => {
    await service.saveCandles([]);

    expect(ohlcRepository.insert).not.toHaveBeenCalled();
  });

  it('saveCandles inserts candles', async () => {
    const candles = [{ coinId: 'btc' }] as Partial<OHLCCandle>[];

    await service.saveCandles(candles);

    expect(ohlcRepository.insert).toHaveBeenCalledWith(candles);
  });

  it('upsertCandles skips upsert when empty', async () => {
    await service.upsertCandles([]);

    expect(ohlcRepository.upsert).not.toHaveBeenCalled();
  });

  it('upsertCandles upserts with conflict paths', async () => {
    const candles = [{ coinId: 'btc', exchangeId: 'binance' }] as Partial<OHLCCandle>[];

    await service.upsertCandles(candles);

    expect(ohlcRepository.upsert).toHaveBeenCalledWith(candles, {
      conflictPaths: ['coinId', 'timestamp', 'exchangeId'],
      skipUpdateIfNoValuesChanged: true
    });
  });

  it('getCandlesByDateRange returns empty for empty coin list', async () => {
    const result = await service.getCandlesByDateRange([], new Date('2024-01-01'), new Date('2024-01-02'));

    expect(result).toEqual([]);
    expect(ohlcRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('getCandlesByDateRange returns query results', async () => {
    const qb = createQueryBuilder();
    const candles = [{ coinId: 'btc' }] as OHLCCandle[];
    qb.getMany.mockResolvedValue(candles);
    (ohlcRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

    const result = await service.getCandlesByDateRange(['btc'], new Date('2024-01-01'), new Date('2024-01-02'));

    expect(qb.where).toHaveBeenCalled();
    expect(qb.andWhere).toHaveBeenCalledTimes(2);
    expect(result).toEqual(candles);
  });

  it('getCandlesByDateRangeGrouped groups by coin', async () => {
    const candles = [
      {
        coinId: 'btc',
        timestamp: new Date('2024-01-01T00:00:00Z'),
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 10
      },
      {
        coinId: 'eth',
        timestamp: new Date('2024-01-01T00:00:00Z'),
        open: 3,
        high: 4,
        low: 2.5,
        close: 3.5,
        volume: 20
      }
    ] as OHLCCandle[];

    jest.spyOn(service, 'getCandlesByDateRange').mockResolvedValue(candles);

    const result = await service.getCandlesByDateRangeGrouped(
      ['btc', 'eth'],
      new Date('2024-01-01'),
      new Date('2024-01-02')
    );

    expect(result.btc).toHaveLength(1);
    expect(result.eth).toHaveLength(1);
    expect(result.btc[0].open).toBe(1);
  });

  it('getLatestCandle requests most recent', async () => {
    const candle = { coinId: 'btc' } as OHLCCandle;
    ohlcRepository.findOne.mockResolvedValue(candle);

    const result = await service.getLatestCandle('btc');

    expect(ohlcRepository.findOne).toHaveBeenCalledWith({
      where: { coinId: 'btc' },
      order: { timestamp: 'DESC' }
    });
    expect(result).toBe(candle);
  });

  it('getLatestCandles returns map keyed by coin', async () => {
    const qb = createQueryBuilder();
    const candles = [
      { coinId: 'btc', timestamp: new Date('2024-01-01T00:00:00Z') },
      { coinId: 'eth', timestamp: new Date('2024-01-01T00:00:00Z') }
    ] as OHLCCandle[];
    qb.getMany.mockResolvedValue(candles);
    (ohlcRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

    const result = await service.getLatestCandles(['btc', 'eth']);

    expect(qb.distinctOn).toHaveBeenCalledWith(['candle.coinId']);
    expect(qb.orderBy).toHaveBeenCalledWith('candle.coinId');
    expect(qb.addOrderBy).toHaveBeenCalledWith('candle.timestamp', 'DESC');
    expect(result.get('btc')).toEqual(candles[0]);
    expect(result.get('eth')).toEqual(candles[1]);
  });

  it('getCandleCount supports optional coinId filter', async () => {
    ohlcRepository.count.mockResolvedValueOnce(12).mockResolvedValueOnce(3);

    await expect(service.getCandleCount()).resolves.toBe(12);
    await expect(service.getCandleCount('btc')).resolves.toBe(3);

    expect(ohlcRepository.count).toHaveBeenNthCalledWith(1, { where: {} });
    expect(ohlcRepository.count).toHaveBeenNthCalledWith(2, { where: { coinId: 'btc' } });
  });

  it('getCoinsWithCandleData filters empty ids', async () => {
    const qb = createQueryBuilder();
    qb.getRawMany.mockResolvedValue([{ coinId: 'btc' }, { coinId: '' }, { coinId: null }]);
    (ohlcRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

    const result = await service.getCoinsWithCandleData();

    expect(result).toEqual(['btc']);
  });

  it('getCandleDataDateRange returns null when no data', async () => {
    const qb = createQueryBuilder();
    qb.getRawOne.mockResolvedValue(null);
    (ohlcRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

    const result = await service.getCandleDataDateRange();

    expect(result).toBeNull();
  });

  it('getCandleDataDateRange converts min/max to dates', async () => {
    const qb = createQueryBuilder();
    qb.getRawOne.mockResolvedValue({ minDate: '2024-01-01T00:00:00Z', maxDate: '2024-01-02T00:00:00Z' });
    (ohlcRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

    const result = await service.getCandleDataDateRange();

    expect(result).toEqual({
      start: new Date('2024-01-01T00:00:00Z'),
      end: new Date('2024-01-02T00:00:00Z')
    });
  });

  it('detectGaps returns gap ranges', async () => {
    const qb = createQueryBuilder();
    qb.getMany.mockResolvedValue([
      { timestamp: new Date('2024-01-01T00:00:00Z') },
      { timestamp: new Date('2024-01-01T03:00:00Z') }
    ] as OHLCCandle[]);
    (ohlcRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

    const gaps = await service.detectGaps('btc', new Date('2024-01-01T00:00:00Z'), new Date('2024-01-01T05:00:00Z'));

    expect(gaps).toEqual([
      { start: new Date('2024-01-01T01:00:00Z'), end: new Date('2024-01-01T02:00:00Z') },
      { start: new Date('2024-01-01T04:00:00Z'), end: new Date('2024-01-01T05:00:00Z') }
    ]);
  });

  it('detectGaps returns empty when consecutive hours are present', async () => {
    const qb = createQueryBuilder();
    qb.getMany.mockResolvedValue([
      { timestamp: new Date('2024-01-01T00:00:00Z') },
      { timestamp: new Date('2024-01-01T01:00:00Z') },
      { timestamp: new Date('2024-01-01T02:00:00Z') }
    ] as OHLCCandle[]);
    (ohlcRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

    const gaps = await service.detectGaps('btc', new Date('2024-01-01T00:00:00Z'), new Date('2024-01-01T03:00:00Z'));

    expect(gaps).toEqual([]);
  });

  it('getGapSummary returns coins with gaps', async () => {
    const qb = createQueryBuilder();
    qb.getRawMany.mockResolvedValue([{ coinId: 'btc' }, { coinId: 'eth' }]);
    (ohlcRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

    jest.spyOn(service, 'detectGaps').mockImplementation(async (coinId: string) => {
      return coinId === 'btc'
        ? [{ start: new Date('2024-01-01T00:00:00Z'), end: new Date('2024-01-01T01:00:00Z') }]
        : [];
    });

    const result = await service.getGapSummary();

    expect(result).toHaveLength(1);
    expect(result[0].coinId).toBe('btc');
    expect(result[0].gapCount).toBe(1);
  });

  it('upsertSymbolMap updates existing mapping', async () => {
    const existing = { id: 'map-1', coinId: 'btc', exchangeId: 'ex-1' } as ExchangeSymbolMap;
    symbolMapRepository.findOne.mockResolvedValue(existing);

    const result = await service.upsertSymbolMap({ coinId: 'btc', exchangeId: 'ex-1', symbol: 'BTC/USD' });

    expect(symbolMapRepository.update).toHaveBeenCalledWith(existing.id, {
      coinId: 'btc',
      exchangeId: 'ex-1',
      symbol: 'BTC/USD'
    });
    expect(result).toEqual({ ...existing, symbol: 'BTC/USD' });
  });

  it('upsertSymbolMap creates new mapping', async () => {
    symbolMapRepository.findOne.mockResolvedValue(null);
    const created = { coinId: 'btc', exchangeId: 'ex-1', symbol: 'BTC/USD' } as ExchangeSymbolMap;
    symbolMapRepository.create.mockReturnValue(created);
    symbolMapRepository.save.mockResolvedValue({ ...created, id: 'map-2' } as ExchangeSymbolMap);

    const result = await service.upsertSymbolMap({ coinId: 'btc', exchangeId: 'ex-1', symbol: 'BTC/USD' });

    expect(symbolMapRepository.create).toHaveBeenCalledWith({
      coinId: 'btc',
      exchangeId: 'ex-1',
      symbol: 'BTC/USD'
    });
    expect(result.id).toBe('map-2');
  });

  it('getActiveSymbolMaps filters by exchange when provided', async () => {
    symbolMapRepository.find.mockResolvedValue([]);

    await service.getActiveSymbolMaps('ex-1');

    expect(symbolMapRepository.find).toHaveBeenCalledWith({
      where: { isActive: true, exchangeId: 'ex-1' },
      order: { priority: 'ASC' },
      relations: ['coin', 'exchange']
    });
  });

  it('getSymbolMapsForCoins skips empty input', async () => {
    const result = await service.getSymbolMapsForCoins([]);

    expect(result).toEqual([]);
    expect(symbolMapRepository.find).not.toHaveBeenCalled();
  });

  it('updateSymbolMapStatus updates isActive', async () => {
    await service.updateSymbolMapStatus('map-1', false);

    expect(symbolMapRepository.update).toHaveBeenCalledWith('map-1', { isActive: false });
  });

  it('incrementFailureCount increments failure count', async () => {
    await service.incrementFailureCount('map-1');

    expect(symbolMapRepository.increment).toHaveBeenCalledWith({ id: 'map-1' }, 'failureCount', 1);
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

  it('pruneOldCandles returns affected count', async () => {
    ohlcRepository.delete.mockResolvedValue({ affected: 4 } as any);

    const result = await service.pruneOldCandles(30);

    expect(result).toBe(4);
    expect(ohlcRepository.delete).toHaveBeenCalled();
  });

  it('pruneOldCandles returns 0 when nothing deleted', async () => {
    ohlcRepository.delete.mockResolvedValue({ affected: undefined } as any);

    const result = await service.pruneOldCandles(30);

    expect(result).toBe(0);
  });

  it('getSyncStatus returns summary', async () => {
    const qb = createQueryBuilder();
    qb.getRawOne.mockResolvedValue({ count: '2' });
    qb.getOne
      .mockResolvedValueOnce({ timestamp: new Date('2024-01-01T00:00:00Z') } as OHLCCandle)
      .mockResolvedValueOnce({ timestamp: new Date('2024-01-02T00:00:00Z') } as OHLCCandle);
    (ohlcRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

    ohlcRepository.count.mockResolvedValue(10);
    symbolMapRepository.findOne.mockResolvedValue({ lastSyncAt: new Date('2024-01-02T01:00:00Z') } as any);

    const result = await service.getSyncStatus();

    expect(result).toEqual({
      totalCandles: 10,
      coinsWithData: 2,
      oldestCandle: new Date('2024-01-01T00:00:00Z'),
      newestCandle: new Date('2024-01-02T00:00:00Z'),
      lastSyncTime: new Date('2024-01-02T01:00:00Z')
    });
  });

  it('getStaleCoins returns query results', async () => {
    const qb = createQueryBuilder();
    const mappings = [{ coinId: 'btc' }] as ExchangeSymbolMap[];
    qb.getMany.mockResolvedValue(mappings);
    (symbolMapRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

    const result = await service.getStaleCoins(2);

    expect(result).toEqual(mappings);
    expect(qb.andWhere).toHaveBeenCalled();
  });

  it('findAllByDay aggregates candles', async () => {
    const candles = [
      {
        coinId: 'btc',
        timestamp: new Date('2024-01-01T00:00:00Z'),
        open: 1,
        high: 3,
        low: 0.5,
        close: 2,
        volume: 5
      },
      {
        coinId: 'btc',
        timestamp: new Date('2024-01-01T01:00:00Z'),
        open: 2,
        high: 4,
        low: 1,
        close: 3,
        volume: 7
      }
    ] as OHLCCandle[];

    jest.spyOn(service, 'getCandlesByDateRange').mockResolvedValue(candles);

    const result = await service.findAllByDay('btc', '1d');

    expect(result.btc).toHaveLength(1);
    expect(result.btc[0].high).toBe(4);
    expect(result.btc[0].low).toBe(0.5);
    expect(result.btc[0].open).toBe(1);
    expect(result.btc[0].close).toBe(3);
    expect(result.btc[0].volume).toBe(12);
  });

  it('findAllByHour groups by hour', async () => {
    const candles = [
      {
        coinId: 'btc',
        timestamp: new Date('2024-01-01T00:00:00Z'),
        open: 1,
        high: 3,
        low: 0.5,
        close: 2,
        volume: 5
      },
      {
        coinId: 'btc',
        timestamp: new Date('2024-01-01T01:00:00Z'),
        open: 2,
        high: 4,
        low: 1,
        close: 3,
        volume: 7
      }
    ] as OHLCCandle[];

    jest.spyOn(service, 'getCandlesByDateRange').mockResolvedValue(candles);

    const result = await service.findAllByHour('btc', '1d');

    expect(result.btc).toHaveLength(2);
  });

  it('findAllByDay uses range-based dates', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-10T00:00:00Z'));
    const candles = [{ coinId: 'btc', timestamp: new Date('2024-01-09T00:00:00Z') }] as OHLCCandle[];
    jest.spyOn(service, 'getCandlesByDateRange').mockResolvedValue(candles);

    await service.findAllByDay('btc', '7d');

    const [coinIds, startDate, endDate] = (service.getCandlesByDateRange as jest.Mock).mock.calls[0];
    expect(coinIds).toEqual(['btc']);
    expect(endDate).toEqual(new Date('2024-01-10T00:00:00Z'));
    expect(startDate).toEqual(new Date('2024-01-03T00:00:00Z'));

    jest.useRealTimers();
  });
});
