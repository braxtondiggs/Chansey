import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { type ObjectLiteral, type Repository, type SelectQueryBuilder } from 'typeorm';

import { SignalAnalyticsService } from './signal-analytics.service';

import { Coin } from '../../coin/coin.entity';
import { BacktestSignal, SignalDirection, SignalType } from '../../order/backtest/backtest-signal.entity';
import { Backtest } from '../../order/backtest/backtest.entity';

type MockRepo<T extends ObjectLiteral> = Partial<jest.Mocked<Repository<T>>>;

const createMockQueryBuilder = () => {
  const qb: Partial<SelectQueryBuilder<any>> = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue({}),
    getRawMany: jest.fn().mockResolvedValue([])
  };
  return qb as SelectQueryBuilder<any>;
};

describe('SignalAnalyticsService', () => {
  let service: SignalAnalyticsService;
  let backtestRepo: MockRepo<Backtest>;
  let signalRepo: MockRepo<BacktestSignal>;
  let coinRepo: MockRepo<Coin>;
  let mockQueryBuilder: SelectQueryBuilder<any>;

  beforeEach(async () => {
    mockQueryBuilder = createMockQueryBuilder();
    backtestRepo = { createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder) };
    signalRepo = { createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder) };
    coinRepo = { createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalAnalyticsService,
        { provide: getRepositoryToken(Backtest), useValue: backtestRepo },
        { provide: getRepositoryToken(BacktestSignal), useValue: signalRepo },
        { provide: getRepositoryToken(Coin), useValue: coinRepo }
      ]
    }).compile();

    service = module.get(SignalAnalyticsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getSignalAnalytics', () => {
    it('returns empty analytics when no backtests match filters', async () => {
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.getSignalAnalytics({});

      expect(result).toEqual({
        overall: {
          totalSignals: 0,
          entryCount: 0,
          exitCount: 0,
          adjustmentCount: 0,
          riskControlCount: 0,
          avgConfidence: 0
        },
        byConfidenceBucket: [],
        bySignalType: [],
        byDirection: [],
        byInstrument: []
      });
    });

    it('returns fully parsed signal analytics when backtests exist', async () => {
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([{ b_id: 'bt-1' }]);
      (mockQueryBuilder.getRawOne as jest.Mock).mockResolvedValueOnce({
        totalSignals: '100',
        entryCount: '40',
        exitCount: '35',
        adjustmentCount: '15',
        riskControlCount: '10',
        avgConfidence: '0.72'
      });
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([
        { bucket: '60-80%', signalCount: '30', successRate: '0.65', avgReturn: '2.5' }
      ]);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([
        { type: SignalType.ENTRY, count: '40', successRate: '0.62', avgReturn: '3.0' }
      ]);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([
        { direction: SignalDirection.LONG, count: '60', successRate: '0.58', avgReturn: '2.8' }
      ]);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([
        { instrument: 'BTC/USDT', count: '50', successRate: '0.7', avgReturn: '4.0' }
      ]);

      const result = await service.getSignalAnalytics({});

      expect(result.overall).toEqual({
        totalSignals: 100,
        entryCount: 40,
        exitCount: 35,
        adjustmentCount: 15,
        riskControlCount: 10,
        avgConfidence: 0.72
      });
      expect(result.bySignalType).toEqual([{ type: SignalType.ENTRY, count: 40, successRate: 0.62, avgReturn: 3.0 }]);
      expect(result.byDirection).toEqual([
        { direction: SignalDirection.LONG, count: 60, successRate: 0.58, avgReturn: 2.8 }
      ]);
      expect(result.byInstrument).toEqual([{ instrument: 'BTC/USDT', count: 50, successRate: 0.7, avgReturn: 4.0 }]);
    });

    it('coerces null/missing overall stats fields to zero', async () => {
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([{ b_id: 'bt-1' }]);
      (mockQueryBuilder.getRawOne as jest.Mock).mockResolvedValueOnce({});
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([]);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([]);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([]);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.getSignalAnalytics({});

      expect(result.overall).toEqual({
        totalSignals: 0,
        entryCount: 0,
        exitCount: 0,
        adjustmentCount: 0,
        riskControlCount: 0,
        avgConfidence: 0
      });
    });

    it('fills missing confidence buckets with zero entries in fixed order', async () => {
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([{ b_id: 'bt-1' }]);
      (mockQueryBuilder.getRawOne as jest.Mock).mockResolvedValueOnce({
        totalSignals: '10',
        entryCount: '10',
        exitCount: '0',
        adjustmentCount: '0',
        riskControlCount: '0',
        avgConfidence: '0.9'
      });
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([
        { bucket: '80-100%', signalCount: '10', successRate: '0.8', avgReturn: '5.0' }
      ]);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([]);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([]);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.getSignalAnalytics({});

      expect(result.byConfidenceBucket).toEqual([
        { bucket: '0-20%', signalCount: 0, successRate: 0, avgReturn: 0 },
        { bucket: '20-40%', signalCount: 0, successRate: 0, avgReturn: 0 },
        { bucket: '40-60%', signalCount: 0, successRate: 0, avgReturn: 0 },
        { bucket: '60-80%', signalCount: 0, successRate: 0, avgReturn: 0 },
        { bucket: '80-100%', signalCount: 10, successRate: 0.8, avgReturn: 5.0 }
      ]);
    });

    it('resolves instrument UUIDs to coin symbols via coinRepo', async () => {
      const uuid = '11111111-2222-4333-8444-555555555555';
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([{ b_id: 'bt-1' }]);
      (mockQueryBuilder.getRawOne as jest.Mock).mockResolvedValueOnce({
        totalSignals: '1',
        entryCount: '1',
        exitCount: '0',
        adjustmentCount: '0',
        riskControlCount: '0',
        avgConfidence: '0.5'
      });
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([]);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([]);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([]);
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([
        { instrument: uuid, count: '5', successRate: '0.6', avgReturn: '1.5' }
      ]);
      // resolveInstrumentSymbols coin lookup via coinRepo.createQueryBuilder().getMany()
      (mockQueryBuilder as unknown as { getMany: jest.Mock }).getMany = jest
        .fn()
        .mockResolvedValue([{ id: uuid, symbol: 'btc' }]);

      const result = await service.getSignalAnalytics({});

      expect(result.byInstrument[0].instrument).toBe('BTC');
    });
  });
});
