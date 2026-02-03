import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Repository, SelectQueryBuilder } from 'typeorm';

import { BacktestMonitoringService } from './backtest-monitoring.service';
import { ExportFormat } from './dto/backtest-listing.dto';
import { BacktestFiltersDto } from './dto/overview.dto';

import {
  Backtest,
  BacktestSignal,
  BacktestStatus,
  BacktestTrade,
  BacktestType,
  SignalDirection,
  SignalType,
  SimulatedOrderFill,
  TradeStatus,
  TradeType
} from '../../order/backtest/backtest.entity';

type MockRepo<T> = Partial<jest.Mocked<Repository<T>>>;

const createMockQueryBuilder = () => {
  const qb: Partial<SelectQueryBuilder<any>> = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    addGroupBy: jest.fn().mockReturnThis(),
    having: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(0),
    getMany: jest.fn().mockResolvedValue([]),
    getRawOne: jest.fn().mockResolvedValue({}),
    getRawMany: jest.fn().mockResolvedValue([])
  };
  return qb as SelectQueryBuilder<any>;
};

const createBacktest = (overrides: Partial<Backtest> = {}): Backtest => {
  const now = new Date();
  return {
    id: overrides.id ?? 'backtest-1',
    name: overrides.name ?? 'Test Backtest',
    description: overrides.description ?? 'Test description',
    type: overrides.type ?? BacktestType.HISTORICAL,
    status: overrides.status ?? BacktestStatus.COMPLETED,
    initialCapital: overrides.initialCapital ?? 10000,
    tradingFee: overrides.tradingFee ?? 0.001,
    startDate: overrides.startDate ?? new Date('2024-01-01'),
    endDate: overrides.endDate ?? new Date('2024-12-31'),
    finalValue: overrides.finalValue ?? 11500,
    totalReturn: overrides.totalReturn ?? 15,
    annualizedReturn: overrides.annualizedReturn ?? 15,
    sharpeRatio: overrides.sharpeRatio ?? 1.5,
    maxDrawdown: overrides.maxDrawdown ?? 10,
    totalTrades: overrides.totalTrades ?? 50,
    winningTrades: overrides.winningTrades ?? 30,
    winRate: overrides.winRate ?? 0.6,
    errorMessage: overrides.errorMessage ?? null,
    strategyParams: overrides.strategyParams ?? {},
    performanceMetrics: overrides.performanceMetrics ?? {},
    configSnapshot: overrides.configSnapshot ?? {},
    deterministicSeed: overrides.deterministicSeed ?? null,
    warningFlags: overrides.warningFlags ?? [],
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    completedAt: overrides.completedAt ?? now,
    checkpointState: overrides.checkpointState ?? null,
    lastCheckpointAt: overrides.lastCheckpointAt ?? null,
    processedTimestampCount: overrides.processedTimestampCount ?? 100,
    totalTimestampCount: overrides.totalTimestampCount ?? 100,
    liveReplayState: overrides.liveReplayState ?? null,
    user: overrides.user ?? ({ id: 'user-1', email: 'test@test.com' } as any),
    algorithm: overrides.algorithm ?? ({ id: 'algo-1', name: 'Test Algorithm' } as any),
    marketDataSet: overrides.marketDataSet ?? null,
    trades: overrides.trades ?? [],
    performanceSnapshots: overrides.performanceSnapshots ?? [],
    signals: overrides.signals ?? [],
    simulatedFills: overrides.simulatedFills ?? []
  } as Backtest;
};

const createTrade = (overrides: Partial<BacktestTrade> = {}): BacktestTrade => {
  return {
    id: overrides.id ?? 'trade-1',
    type: overrides.type ?? TradeType.BUY,
    status: overrides.status ?? TradeStatus.EXECUTED,
    quantity: overrides.quantity ?? 1,
    price: overrides.price ?? 100,
    totalValue: overrides.totalValue ?? 100,
    fee: overrides.fee ?? 0.1,
    realizedPnL: overrides.realizedPnL ?? null,
    realizedPnLPercent: overrides.realizedPnLPercent ?? null,
    costBasis: overrides.costBasis ?? null,
    executedAt: overrides.executedAt ?? new Date(),
    signal: overrides.signal ?? null,
    metadata: overrides.metadata ?? {},
    backtest: overrides.backtest ?? ({} as any),
    baseCoin: overrides.baseCoin ?? ({ symbol: 'BTC' } as any),
    quoteCoin: overrides.quoteCoin ?? ({ symbol: 'USDT' } as any)
  } as BacktestTrade;
};

const createSignal = (overrides: Partial<BacktestSignal> = {}): BacktestSignal => {
  return {
    id: overrides.id ?? 'signal-1',
    timestamp: overrides.timestamp ?? new Date(),
    signalType: overrides.signalType ?? SignalType.ENTRY,
    instrument: overrides.instrument ?? 'BTC/USDT',
    direction: overrides.direction ?? SignalDirection.LONG,
    quantity: overrides.quantity ?? 1,
    price: overrides.price ?? 50000,
    reason: overrides.reason ?? 'Test signal',
    confidence: overrides.confidence ?? 0.75,
    payload: overrides.payload ?? {},
    backtest: overrides.backtest ?? ({} as any),
    simulatedFills: overrides.simulatedFills ?? []
  } as BacktestSignal;
};

describe('BacktestMonitoringService', () => {
  let service: BacktestMonitoringService;
  let backtestRepo: MockRepo<Backtest>;
  let tradeRepo: MockRepo<BacktestTrade>;
  let signalRepo: MockRepo<BacktestSignal>;
  let fillRepo: MockRepo<SimulatedOrderFill>;
  let mockQueryBuilder: SelectQueryBuilder<any>;

  beforeEach(async () => {
    mockQueryBuilder = createMockQueryBuilder();

    backtestRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      count: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockResolvedValue([]),
      existsBy: jest.fn().mockResolvedValue(true)
    };

    tradeRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      find: jest.fn().mockResolvedValue([])
    };

    signalRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      find: jest.fn().mockResolvedValue([])
    };

    fillRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BacktestMonitoringService,
        { provide: getRepositoryToken(Backtest), useValue: backtestRepo },
        { provide: getRepositoryToken(BacktestTrade), useValue: tradeRepo },
        { provide: getRepositoryToken(BacktestSignal), useValue: signalRepo },
        { provide: getRepositoryToken(SimulatedOrderFill), useValue: fillRepo }
      ]
    }).compile();

    service = module.get(BacktestMonitoringService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getOverview', () => {
    it('returns overview with status counts and metrics', async () => {
      // Mock status counts
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([
        { status: BacktestStatus.COMPLETED, count: '10' },
        { status: BacktestStatus.RUNNING, count: '5' },
        { status: BacktestStatus.FAILED, count: '2' }
      ]);

      // Mock type distribution
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([
        { type: BacktestType.HISTORICAL, count: '15' },
        { type: BacktestType.LIVE_REPLAY, count: '2' }
      ]);

      // Mock average metrics
      (mockQueryBuilder.getRawOne as jest.Mock).mockResolvedValueOnce({
        avgSharpe: '1.5',
        avgReturn: '12.5',
        avgDrawdown: '8.2',
        avgWinRate: '0.62'
      });

      // Mock recent activity
      (backtestRepo.count as jest.Mock)
        .mockResolvedValueOnce(5) // last24h
        .mockResolvedValueOnce(25) // last7d
        .mockResolvedValueOnce(100); // last30d

      // Mock top algorithms
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([
        { id: 'algo-1', name: 'RSI Strategy', avgSharpe: '2.1', avgReturn: '18.5', backtestCount: '10' }
      ]);

      // Mock total count
      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValueOnce(17);

      const filters: BacktestFiltersDto = {};
      const result = await service.getOverview(filters);

      expect(result).toMatchObject({
        statusCounts: expect.objectContaining({
          [BacktestStatus.COMPLETED]: 10,
          [BacktestStatus.RUNNING]: 5,
          [BacktestStatus.FAILED]: 2
        }),
        typeDistribution: expect.objectContaining({
          [BacktestType.HISTORICAL]: 15,
          [BacktestType.LIVE_REPLAY]: 2
        }),
        averageMetrics: {
          sharpeRatio: 1.5,
          totalReturn: 12.5,
          maxDrawdown: 8.2,
          winRate: 0.62
        },
        recentActivity: {
          last24h: 5,
          last7d: 25,
          last30d: 100
        },
        topAlgorithms: expect.arrayContaining([
          expect.objectContaining({
            id: 'algo-1',
            name: 'RSI Strategy',
            avgSharpe: 2.1
          })
        ]),
        totalBacktests: 17
      });
    });

    it('applies date filters when provided', async () => {
      const filters: BacktestFiltersDto = {
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-12-31T23:59:59.999Z'
      };

      // Set up all required mocks
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValue([]);
      (mockQueryBuilder.getRawOne as jest.Mock).mockResolvedValue({});
      (backtestRepo.count as jest.Mock).mockResolvedValue(0);
      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValue(0);

      await service.getOverview(filters);

      expect(mockQueryBuilder.where).toHaveBeenCalled();
    });
  });

  describe('getBacktests', () => {
    it('returns paginated backtest list', async () => {
      const backtests = [createBacktest({ id: 'bt-1' }), createBacktest({ id: 'bt-2' })];

      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValueOnce(2);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce(backtests);

      const result = await service.getBacktests({ page: 1, limit: 10 });

      expect(result).toMatchObject({
        data: expect.arrayContaining([
          expect.objectContaining({ id: 'bt-1' }),
          expect.objectContaining({ id: 'bt-2' })
        ]),
        total: 2,
        page: 1,
        limit: 10,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false
      });
    });

    it('applies search filter when provided', async () => {
      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValueOnce(0);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce([]);

      await service.getBacktests({ search: 'test', page: 1, limit: 10 });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('b.name ILIKE :search', { search: '%test%' });
    });

    it('calculates correct pagination metadata', async () => {
      (mockQueryBuilder.getCount as jest.Mock).mockResolvedValueOnce(25);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.getBacktests({ page: 2, limit: 10 });

      expect(result).toMatchObject({
        total: 25,
        page: 2,
        limit: 10,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true
      });
    });
  });

  describe('getSignalAnalytics', () => {
    it('returns empty analytics when no backtests match filters', async () => {
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.getSignalAnalytics({});

      expect(result).toMatchObject({
        overall: {
          totalSignals: 0,
          entryCount: 0,
          exitCount: 0,
          avgConfidence: 0
        },
        byConfidenceBucket: [],
        bySignalType: [],
        byDirection: [],
        byInstrument: []
      });
    });

    it('returns signal analytics when backtests exist', async () => {
      // Mock backtest IDs
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([{ b_id: 'bt-1' }]);

      // Mock overall stats
      (mockQueryBuilder.getRawOne as jest.Mock).mockResolvedValueOnce({
        totalSignals: '100',
        entryCount: '40',
        exitCount: '35',
        adjustmentCount: '15',
        riskControlCount: '10',
        avgConfidence: '0.72'
      });

      // Mock confidence buckets
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([
        { bucket: '60-80%', signalCount: '30', successRate: '0.65', avgReturn: '2.5' }
      ]);

      // Mock by type
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([
        { type: SignalType.ENTRY, count: '40', successRate: '0.62', avgReturn: '3.0' }
      ]);

      // Mock by direction
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([
        { direction: SignalDirection.LONG, count: '60', successRate: '0.58', avgReturn: '2.8' }
      ]);

      // Mock by instrument
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([
        { instrument: 'BTC/USDT', count: '50', successRate: '0.70', avgReturn: '4.0' }
      ]);

      const result = await service.getSignalAnalytics({});

      expect(result.overall).toMatchObject({
        totalSignals: 100,
        entryCount: 40,
        exitCount: 35,
        avgConfidence: 0.72
      });

      expect(result.bySignalType).toHaveLength(1);
      expect(result.byInstrument).toHaveLength(1);
    });
  });

  describe('getTradeAnalytics', () => {
    it('returns empty analytics when no backtests match filters', async () => {
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.getTradeAnalytics({});

      expect(result).toMatchObject({
        summary: {
          totalTrades: 0,
          totalVolume: 0,
          totalFees: 0
        },
        profitability: {
          winCount: 0,
          lossCount: 0,
          winRate: 0
        }
      });
    });

    it('returns trade analytics when backtests exist', async () => {
      // Mock backtest IDs
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([{ b_id: 'bt-1' }]);

      // Mock trade summary
      (mockQueryBuilder.getRawOne as jest.Mock).mockResolvedValueOnce({
        totalTrades: '50',
        totalVolume: '100000',
        totalFees: '100',
        buyCount: '25',
        sellCount: '25'
      });

      // Mock profitability
      (mockQueryBuilder.getRawOne as jest.Mock).mockResolvedValueOnce({
        winCount: '15',
        lossCount: '10',
        grossProfit: '5000',
        grossLoss: '2000',
        largestWin: '1000',
        largestLoss: '-500',
        avgWin: '333',
        avgLoss: '-200',
        totalRealizedPnL: '3000'
      });

      // Mock duration stats (with empty trades)
      (tradeRepo.find as jest.Mock).mockResolvedValueOnce([]);

      // Mock slippage
      (mockQueryBuilder.getRawOne as jest.Mock).mockResolvedValueOnce({
        avgBps: '5.5',
        totalImpact: '50',
        maxBps: '15',
        fillCount: '40'
      });

      // Mock p95 slippage
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([]);

      // Mock by instrument
      (mockQueryBuilder.getRawMany as jest.Mock).mockResolvedValueOnce([
        {
          instrument: 'BTC/USDT',
          tradeCount: '30',
          totalReturn: '10.5',
          winRate: '0.65',
          totalVolume: '50000',
          totalPnL: '2000'
        }
      ]);

      const result = await service.getTradeAnalytics({});

      expect(result.summary).toMatchObject({
        totalTrades: 50,
        totalVolume: 100000,
        totalFees: 100,
        buyCount: 25,
        sellCount: 25
      });

      expect(result.profitability).toMatchObject({
        winCount: 15,
        lossCount: 10,
        profitFactor: 2.5
      });
    });
  });

  describe('exportBacktests', () => {
    it('returns JSON data when format is JSON', async () => {
      const backtests = [createBacktest()];
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce(backtests);

      const result = await service.exportBacktests({}, ExportFormat.JSON);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect((result as any[])[0]).toHaveProperty('id');
    });

    it('returns CSV buffer when format is CSV', async () => {
      const backtests = [createBacktest()];
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce(backtests);

      const result = await service.exportBacktests({}, ExportFormat.CSV);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString()).toContain('id,');
    });

    it('returns empty data when no backtests exist', async () => {
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce([]);

      const jsonResult = await service.exportBacktests({}, ExportFormat.JSON);
      expect(jsonResult).toEqual([]);

      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce([]);

      const csvResult = await service.exportBacktests({}, ExportFormat.CSV);
      expect(csvResult.toString()).toBe('');
    });
  });

  describe('exportSignals', () => {
    it('returns signals for a specific backtest', async () => {
      const signals = [createSignal()];
      (signalRepo.find as jest.Mock).mockResolvedValueOnce(signals);

      const result = await service.exportSignals('bt-1', ExportFormat.JSON);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(signalRepo.find).toHaveBeenCalledWith({
        where: { backtest: { id: 'bt-1' } },
        order: { timestamp: 'ASC' }
      });
    });
  });

  describe('exportTrades', () => {
    it('returns trades for a specific backtest', async () => {
      const trades = [createTrade()];
      (tradeRepo.find as jest.Mock).mockResolvedValueOnce(trades);

      const result = await service.exportTrades('bt-1', ExportFormat.JSON);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(tradeRepo.find).toHaveBeenCalledWith({
        where: { backtest: { id: 'bt-1' } },
        relations: ['baseCoin', 'quoteCoin'],
        order: { executedAt: 'ASC' }
      });
    });
  });
});
