import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';

import { BacktestMonitoringQueryService } from './backtest-monitoring-query.service';

import { Backtest, BacktestStatus, BacktestType } from '../../order/backtest/backtest.entity';

type MockRepo<T extends ObjectLiteral> = Partial<jest.Mocked<Repository<T>>>;

const createMockQueryBuilder = () => {
  const qb: Partial<SelectQueryBuilder<any>> = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    addGroupBy: jest.fn().mockReturnThis(),
    having: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(0),
    getRawOne: jest.fn().mockResolvedValue({}),
    getRawMany: jest.fn().mockResolvedValue([])
  };
  return qb as SelectQueryBuilder<any>;
};

const DATE_RANGE = { start: new Date('2026-01-01'), end: new Date('2026-02-01') };

describe('BacktestMonitoringQueryService', () => {
  let service: BacktestMonitoringQueryService;
  let backtestRepo: MockRepo<Backtest>;
  let qb: SelectQueryBuilder<any>;

  beforeEach(async () => {
    qb = createMockQueryBuilder();
    backtestRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      count: jest.fn().mockResolvedValue(0)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [BacktestMonitoringQueryService, { provide: getRepositoryToken(Backtest), useValue: backtestRepo }]
    }).compile();

    service = module.get(BacktestMonitoringQueryService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getStatusCounts', () => {
    it('initializes every status to 0 then fills in actual counts', async () => {
      (qb.getRawMany as jest.Mock).mockResolvedValueOnce([
        { status: BacktestStatus.COMPLETED, count: '10' },
        { status: BacktestStatus.RUNNING, count: '5' }
      ]);

      const result = await service.getStatusCounts({}, null);

      expect(result[BacktestStatus.COMPLETED]).toBe(10);
      expect(result[BacktestStatus.RUNNING]).toBe(5);
      expect(result[BacktestStatus.FAILED]).toBe(0);
    });

    it('applies dateRange, algorithmId, and type filters', async () => {
      await service.getStatusCounts({ algorithmId: 'algo-1', type: BacktestType.HISTORICAL }, DATE_RANGE);

      expect(qb.where).toHaveBeenCalledWith('b.createdAt BETWEEN :start AND :end', DATE_RANGE);
      expect(qb.andWhere).toHaveBeenCalledWith('b.algorithmId = :algorithmId', { algorithmId: 'algo-1' });
      expect(qb.andWhere).toHaveBeenCalledWith('b.type = :type', { type: BacktestType.HISTORICAL });
    });
  });

  describe('getTypeDistribution', () => {
    it('returns per-type counts with zero defaults', async () => {
      (qb.getRawMany as jest.Mock).mockResolvedValueOnce([{ type: BacktestType.HISTORICAL, count: '15' }]);

      const result = await service.getTypeDistribution({}, null);

      expect(result[BacktestType.HISTORICAL]).toBe(15);
      expect(result[BacktestType.LIVE_REPLAY]).toBe(0);
    });

    it('applies dateRange, algorithmId, and status filters', async () => {
      await service.getTypeDistribution({ algorithmId: 'algo-1', status: BacktestStatus.COMPLETED }, DATE_RANGE);

      expect(qb.where).toHaveBeenCalledWith('b.createdAt BETWEEN :start AND :end', DATE_RANGE);
      expect(qb.andWhere).toHaveBeenCalledWith('b.algorithmId = :algorithmId', { algorithmId: 'algo-1' });
      expect(qb.andWhere).toHaveBeenCalledWith('b.status = :status', { status: BacktestStatus.COMPLETED });
    });
  });

  describe('getAverageMetrics', () => {
    it('parses numeric strings to numbers', async () => {
      (qb.getRawOne as jest.Mock).mockResolvedValueOnce({
        avgSharpe: '1.5',
        avgReturn: '12.5',
        avgDrawdown: '8.2',
        avgWinRate: '0.62'
      });

      const result = await service.getAverageMetrics({}, null);

      expect(result).toEqual({ sharpeRatio: 1.5, totalReturn: 12.5, maxDrawdown: 8.2, winRate: 0.62 });
    });

    it('defaults to zero when row is empty or undefined', async () => {
      (qb.getRawOne as jest.Mock).mockResolvedValueOnce(undefined);

      const result = await service.getAverageMetrics({}, null);

      expect(result).toEqual({ sharpeRatio: 0, totalReturn: 0, maxDrawdown: 0, winRate: 0 });
    });

    it('always scopes to COMPLETED and applies optional filters', async () => {
      await service.getAverageMetrics({ algorithmId: 'algo-1', type: BacktestType.HISTORICAL }, DATE_RANGE);

      expect(qb.where).toHaveBeenCalledWith('b.status = :completed', { completed: BacktestStatus.COMPLETED });
      expect(qb.andWhere).toHaveBeenCalledWith('b.createdAt BETWEEN :start AND :end', DATE_RANGE);
      expect(qb.andWhere).toHaveBeenCalledWith('b.algorithmId = :algorithmId', { algorithmId: 'algo-1' });
      expect(qb.andWhere).toHaveBeenCalledWith('b.type = :type', { type: BacktestType.HISTORICAL });
    });
  });

  describe('getTopAlgorithms', () => {
    it('maps rows to DTOs and enforces ranking constraints', async () => {
      (qb.getRawMany as jest.Mock).mockResolvedValueOnce([
        { id: 'algo-1', name: 'RSI', avgSharpe: '2.1', avgReturn: '18.5', backtestCount: '10' },
        { id: 'algo-2', name: 'MACD', avgSharpe: null, avgReturn: null, backtestCount: '4' }
      ]);

      const result = await service.getTopAlgorithms({}, null);

      expect(result).toEqual([
        { id: 'algo-1', name: 'RSI', avgSharpe: 2.1, avgReturn: 18.5, backtestCount: 10 },
        { id: 'algo-2', name: 'MACD', avgSharpe: 0, avgReturn: 0, backtestCount: 4 }
      ]);
      expect(qb.having).toHaveBeenCalledWith('COUNT(*) >= 3');
      expect(qb.orderBy).toHaveBeenCalledWith('AVG(b.sharpeRatio)', 'DESC');
      expect(qb.limit).toHaveBeenCalledWith(10);
    });
  });
});
