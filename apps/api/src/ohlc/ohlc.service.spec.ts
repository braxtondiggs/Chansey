import { type ObjectLiteral, type Repository } from 'typeorm';

import { type OHLCCandle } from './ohlc-candle.entity';
import { OHLCService } from './ohlc.service';
import { type ExchangeSymbolMapService } from './services/exchange-symbol-map.service';

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
  let symbolMapService: jest.Mocked<ExchangeSymbolMapService>;

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

    symbolMapService = {
      getLastSyncTime: jest.fn()
    } as unknown as jest.Mocked<ExchangeSymbolMapService>;

    service = new OHLCService(ohlcRepository, symbolMapService);
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

  it('getCandlesByDateRange issues a single query when range fits in one chunk', async () => {
    const qb = createQueryBuilder();
    qb.getMany.mockResolvedValue([{ coinId: 'btc' }] as OHLCCandle[]);
    (ohlcRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

    // 90 days exactly — should still be one query
    await service.getCandlesByDateRange(['btc'], new Date('2024-01-01T00:00:00Z'), new Date('2024-03-31T00:00:00Z'));

    expect(ohlcRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
  });

  it('getCandlesByDateRange splits a 365-day range into sequential chunks', async () => {
    const boundaries: Array<{ startDate?: Date; endDate?: Date }> = [];
    (ohlcRepository.createQueryBuilder as jest.Mock).mockImplementation(() => {
      const qb = createQueryBuilder();
      const chunk: { startDate?: Date; endDate?: Date } = {};
      boundaries.push(chunk);
      qb.andWhere.mockImplementation((_clause: string, params?: { startDate?: Date; endDate?: Date }) => {
        if (params?.startDate) chunk.startDate = params.startDate;
        if (params?.endDate) chunk.endDate = params.endDate;
        return qb;
      });
      qb.getMany.mockResolvedValue([{ coinId: 'btc', timestamp: new Date('2024-01-01T00:00:00Z') }] as OHLCCandle[]);
      return qb;
    });

    const startDate = new Date('2024-01-01T00:00:00Z');
    const endDate = new Date('2024-12-31T00:00:00Z');
    const result = await service.getCandlesByDateRange(['btc'], startDate, endDate);

    // 365 days / 90-day chunks = 5 chunks (90 + 90 + 90 + 90 + 5)
    expect(ohlcRepository.createQueryBuilder).toHaveBeenCalledTimes(5);
    expect(result).toHaveLength(5);
    expect(boundaries).toHaveLength(5);

    // First chunk starts at requested startDate, last chunk ends at requested endDate
    expect(boundaries[0].startDate).toEqual(startDate);
    expect(boundaries[boundaries.length - 1].endDate).toEqual(endDate);

    // Chunks are non-overlapping: each chunk starts 1ms after previous chunk's end
    for (let i = 1; i < boundaries.length; i++) {
      const current = boundaries[i].startDate;
      const previous = boundaries[i - 1].endDate;
      expect(current && previous && current.getTime() === previous.getTime() + 1).toBe(true);
    }
  });

  it('getCandlesByDateRange concatenates chunked results preserving order', async () => {
    const resultBatches = [
      [
        { coinId: 'btc', timestamp: new Date('2024-01-02T00:00:00Z') },
        { coinId: 'btc', timestamp: new Date('2024-03-01T00:00:00Z') }
      ],
      [{ coinId: 'btc', timestamp: new Date('2024-05-01T00:00:00Z') }]
    ] as OHLCCandle[][];

    let call = 0;
    (ohlcRepository.createQueryBuilder as jest.Mock).mockImplementation(() => {
      const qb = createQueryBuilder();
      qb.getMany.mockResolvedValue(resultBatches[call++]);
      return qb;
    });

    // 150 days — spans two chunks (90 + 60)
    const result = await service.getCandlesByDateRange(
      ['btc'],
      new Date('2024-01-01T00:00:00Z'),
      new Date('2024-05-30T00:00:00Z')
    );

    expect(result).toHaveLength(3);
    expect(result[0].timestamp).toEqual(new Date('2024-01-02T00:00:00Z'));
    expect(result[1].timestamp).toEqual(new Date('2024-03-01T00:00:00Z'));
    expect(result[2].timestamp).toEqual(new Date('2024-05-01T00:00:00Z'));
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

  it('getCoinsWithCandleDataInRange filters by date range', async () => {
    const qb = createQueryBuilder();
    qb.getRawMany.mockResolvedValue([{ coinId: 'btc' }, { coinId: 'eth' }, { coinId: '' }]);
    (ohlcRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

    const startDate = new Date('2022-01-01');
    const endDate = new Date('2022-12-31');
    const result = await service.getCoinsWithCandleDataInRange(startDate, endDate);

    expect(result).toEqual(['btc', 'eth']);
    expect(qb.where).toHaveBeenCalledWith('candle.timestamp >= :startDate', { startDate });
    expect(qb.andWhere).toHaveBeenCalledWith('candle.timestamp <= :endDate', { endDate });
  });

  it('getCoinsWithCandleDataInRange filters by coinIds when provided', async () => {
    const qb = createQueryBuilder();
    qb.getRawMany.mockResolvedValue([{ coinId: 'btc' }]);
    (ohlcRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

    const startDate = new Date('2022-01-01');
    const endDate = new Date('2022-12-31');
    const coinIds = ['btc', 'eth'];
    const result = await service.getCoinsWithCandleDataInRange(startDate, endDate, coinIds);

    expect(result).toEqual(['btc']);
    expect(qb.andWhere).toHaveBeenCalledWith('candle.coinId IN (:...coinIds)', { coinIds });
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

  it('getSyncStatus returns summary using symbolMapService', async () => {
    const qb = createQueryBuilder();
    qb.getRawOne.mockResolvedValue({ count: '2' });
    qb.getOne
      .mockResolvedValueOnce({ timestamp: new Date('2024-01-01T00:00:00Z') } as OHLCCandle)
      .mockResolvedValueOnce({ timestamp: new Date('2024-01-02T00:00:00Z') } as OHLCCandle);
    (ohlcRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

    ohlcRepository.count.mockResolvedValue(10);
    symbolMapService.getLastSyncTime.mockResolvedValue(new Date('2024-01-02T01:00:00Z'));

    const result = await service.getSyncStatus();

    expect(result).toEqual({
      totalCandles: 10,
      coinsWithData: 2,
      oldestCandle: new Date('2024-01-01T00:00:00Z'),
      newestCandle: new Date('2024-01-02T00:00:00Z'),
      lastSyncTime: new Date('2024-01-02T01:00:00Z')
    });
    expect(symbolMapService.getLastSyncTime).toHaveBeenCalled();
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

  it('findAllByHour preserves individual candle values', async () => {
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
    expect(result.btc[0].open).toBe(2);
    expect(result.btc[0].close).toBe(3);
    expect(result.btc[1].open).toBe(1);
    expect(result.btc[1].close).toBe(2);
  });

  it('findAllByDay accepts a single coin string', async () => {
    const candles = [
      {
        coinId: 'btc',
        timestamp: new Date('2024-01-01T00:00:00Z'),
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 10
      }
    ] as OHLCCandle[];

    jest.spyOn(service, 'getCandlesByDateRange').mockResolvedValue(candles);

    const result = await service.findAllByDay('btc', '1d');

    expect(result.btc).toHaveLength(1);
    const [coinIds] = (service.getCandlesByDateRange as jest.Mock).mock.calls[0];
    expect(coinIds).toEqual(['btc']);
  });

  it('detectGaps includes trailing gap when last candle is before endDate', async () => {
    const qb = createQueryBuilder();
    qb.getMany.mockResolvedValue([{ timestamp: new Date('2024-01-01T00:00:00Z') }] as OHLCCandle[]);
    (ohlcRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

    const gaps = await service.detectGaps('btc', new Date('2024-01-01T00:00:00Z'), new Date('2024-01-01T05:00:00Z'));

    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toEqual({
      start: new Date('2024-01-01T01:00:00Z'),
      end: new Date('2024-01-01T05:00:00Z')
    });
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
