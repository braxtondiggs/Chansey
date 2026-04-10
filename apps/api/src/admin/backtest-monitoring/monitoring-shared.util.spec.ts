import { type Repository, type SelectQueryBuilder } from 'typeorm';

import {
  applyBacktestFilters,
  calculatePaperTradingProgress,
  calculateProgress,
  countRecentActivity,
  formatDuration,
  getDateRange,
  getEmptySignalAnalytics,
  getEmptyTradeAnalytics,
  getFilteredBacktestIds,
  parseDuration,
  resolveInstrumentSymbols
} from './monitoring-shared.util';

import { type Coin } from '../../coin/coin.entity';
import { BacktestType, type Backtest, BacktestStatus } from '../../order/backtest/backtest.entity';
import {
  type PaperTradingSession,
  PaperTradingStatus
} from '../../order/paper-trading/entities/paper-trading-session.entity';

describe('monitoring-shared.util', () => {
  describe('formatDuration', () => {
    it('returns 0m for zero', () => {
      expect(formatDuration(0)).toBe('0m');
    });

    it('formats seconds', () => {
      expect(formatDuration(5_000)).toBe('5s');
    });

    it('formats minutes', () => {
      expect(formatDuration(5 * 60_000)).toBe('5m');
    });

    it('formats hours with minute remainder', () => {
      expect(formatDuration(2 * 60 * 60_000 + 30 * 60_000)).toBe('2h 30m');
    });

    it('formats days with hour remainder', () => {
      expect(formatDuration(3 * 24 * 60 * 60_000 + 5 * 60 * 60_000)).toBe('3d 5h');
    });
  });

  describe('parseDuration', () => {
    it('parses seconds/minutes/hours/days/weeks/months/years', () => {
      expect(parseDuration('10s')).toBe(10_000);
      expect(parseDuration('5m')).toBe(5 * 60_000);
      expect(parseDuration('2h')).toBe(2 * 60 * 60_000);
      expect(parseDuration('1d')).toBe(24 * 60 * 60_000);
      expect(parseDuration('1w')).toBe(7 * 24 * 60 * 60_000);
      expect(parseDuration('1M')).toBe(30 * 24 * 60 * 60_000);
      expect(parseDuration('1y')).toBe(365 * 24 * 60 * 60_000);
    });

    it('returns 0 for malformed input', () => {
      expect(parseDuration('bogus')).toBe(0);
      expect(parseDuration('')).toBe(0);
    });
  });

  describe('getDateRange', () => {
    it('returns null when no dates provided', () => {
      expect(getDateRange({})).toBeNull();
    });

    it('uses epoch when only endDate given', () => {
      const range = getDateRange({ endDate: '2024-01-01' });
      expect(range?.start.getTime()).toBe(0);
      expect(range?.end).toEqual(new Date('2024-01-01'));
    });

    it('uses now when only startDate given', () => {
      const range = getDateRange({ startDate: '2024-01-01' });
      expect(range?.start).toEqual(new Date('2024-01-01'));
      expect(range?.end).toBeInstanceOf(Date);
    });
  });

  describe('calculateProgress', () => {
    it('returns 100 for completed', () => {
      expect(calculateProgress({ status: BacktestStatus.COMPLETED } as Backtest)).toBe(100);
    });

    it('returns 0 for failed/cancelled', () => {
      expect(calculateProgress({ status: BacktestStatus.FAILED } as Backtest)).toBe(0);
      expect(calculateProgress({ status: BacktestStatus.CANCELLED } as Backtest)).toBe(0);
    });

    it('returns 0 when totalTimestampCount is zero', () => {
      expect(
        calculateProgress({
          status: BacktestStatus.RUNNING,
          totalTimestampCount: 0,
          processedTimestampCount: 0
        } as Backtest)
      ).toBe(0);
    });

    it('computes percentage from processed / total', () => {
      expect(
        calculateProgress({
          status: BacktestStatus.RUNNING,
          totalTimestampCount: 200,
          processedTimestampCount: 50
        } as Backtest)
      ).toBe(25);
    });
  });

  describe('calculatePaperTradingProgress', () => {
    it('returns 100 for completed', () => {
      expect(calculatePaperTradingProgress({ status: PaperTradingStatus.COMPLETED } as PaperTradingSession)).toBe(100);
    });

    it('returns 0 for failed/stopped', () => {
      expect(calculatePaperTradingProgress({ status: PaperTradingStatus.FAILED } as PaperTradingSession)).toBe(0);
      expect(calculatePaperTradingProgress({ status: PaperTradingStatus.STOPPED } as PaperTradingSession)).toBe(0);
    });

    it('clamps between 0 and 100', () => {
      const startedAt = new Date(Date.now() - 60 * 60_000); // 1 hour ago
      const session = {
        status: PaperTradingStatus.ACTIVE,
        startedAt,
        duration: '2h'
      } as PaperTradingSession;
      const progress = calculatePaperTradingProgress(session);
      expect(progress).toBeGreaterThanOrEqual(45);
      expect(progress).toBeLessThanOrEqual(55);
    });
  });

  describe('applyBacktestFilters', () => {
    const makeQb = () =>
      ({ andWhere: jest.fn().mockReturnThis() }) as unknown as SelectQueryBuilder<any> & { andWhere: jest.Mock };

    it('adds no clauses when filters and dateRange are empty', () => {
      const qb = makeQb();
      applyBacktestFilters(qb, {} as any, null);
      expect(qb.andWhere).not.toHaveBeenCalled();
    });

    it('applies dateRange, algorithmId, status, and type', () => {
      const qb = makeQb();
      const range = { start: new Date('2024-01-01'), end: new Date('2024-02-01') };
      applyBacktestFilters(
        qb,
        { algorithmId: 'algo-1', status: BacktestStatus.RUNNING, type: BacktestType.HISTORICAL } as any,
        range
      );
      expect(qb.andWhere).toHaveBeenCalledWith('b.createdAt BETWEEN :start AND :end', range);
      expect(qb.andWhere).toHaveBeenCalledWith('b.algorithmId = :algorithmId', { algorithmId: 'algo-1' });
      expect(qb.andWhere).toHaveBeenCalledWith('b.status = :status', { status: BacktestStatus.RUNNING });
      expect(qb.andWhere).toHaveBeenCalledWith('b.type = :type', { type: BacktestType.HISTORICAL });
      expect(qb.andWhere).toHaveBeenCalledTimes(4);
    });
  });

  describe('getFilteredBacktestIds', () => {
    it('maps raw ids from the query builder', async () => {
      const qb = {
        select: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([{ b_id: 'id-1' }, { b_id: 'id-2' }])
      };
      const repo = { createQueryBuilder: jest.fn().mockReturnValue(qb) } as unknown as Repository<Backtest>;

      const ids = await getFilteredBacktestIds(repo, { algorithmId: 'algo-1' }, null);

      expect(ids).toEqual(['id-1', 'id-2']);
      expect(qb.andWhere).toHaveBeenCalledWith('b.algorithmId = :algorithmId', { algorithmId: 'algo-1' });
    });
  });

  describe('countRecentActivity', () => {
    it('returns counts for 24h / 7d / 30d windows', async () => {
      const repo = { count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(5).mockResolvedValueOnce(10) };
      const result = await countRecentActivity(repo as unknown as Repository<Backtest>);
      expect(result).toEqual({ last24h: 1, last7d: 5, last30d: 10 });
      expect(repo.count).toHaveBeenCalledTimes(3);
    });
  });

  describe('resolveInstrumentSymbols', () => {
    it('passes non-UUID values through unchanged when no DB call is needed', async () => {
      const repo = { createQueryBuilder: jest.fn() } as unknown as Repository<Coin>;
      const resolver = await resolveInstrumentSymbols(repo, new Set(['BTC', 'ETH']));
      expect(resolver.resolve('BTC')).toBe('BTC');
      expect(resolver.resolve(null)).toBeUndefined();
    });

    it('resolves UUIDs to uppercase symbols via case-insensitive lookup', async () => {
      const uuid = '11111111-2222-3333-4444-555555555555';
      const qb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([{ id: uuid, symbol: 'btc' }])
      };
      const repo = { createQueryBuilder: jest.fn().mockReturnValue(qb) } as unknown as Repository<Coin>;

      const resolver = await resolveInstrumentSymbols(repo, new Set([uuid, 'ETH']));
      expect(resolver.resolve(uuid.toUpperCase())).toBe('BTC');
      expect(resolver.resolve('ETH')).toBe('ETH');
    });
  });

  describe('empty response helpers', () => {
    it('getEmptySignalAnalytics returns zeroed shape', () => {
      const empty = getEmptySignalAnalytics();
      expect(empty.overall.totalSignals).toBe(0);
      expect(empty.byConfidenceBucket).toEqual([]);
    });

    it('getEmptyTradeAnalytics returns zeroed shape', () => {
      const empty = getEmptyTradeAnalytics();
      expect(empty.summary.totalTrades).toBe(0);
      expect(empty.duration.avgHoldTime).toBe('N/A');
    });
  });
});
