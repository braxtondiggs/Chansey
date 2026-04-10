import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { type ObjectLiteral, type Repository, type SelectQueryBuilder } from 'typeorm';

import { ExportFormat } from './dto/backtest-listing.dto';
import { MonitoringExportService } from './monitoring-export.service';

import { Coin } from '../../coin/coin.entity';
import { BacktestSignal, SignalDirection, SignalType } from '../../order/backtest/backtest-signal.entity';
import { BacktestTrade, TradeStatus, TradeType } from '../../order/backtest/backtest-trade.entity';
import { Backtest, BacktestStatus, BacktestType } from '../../order/backtest/backtest.entity';

type MockRepo<T extends ObjectLiteral> = Partial<jest.Mocked<Repository<T>>>;

const createMockQueryBuilder = () => {
  const qb: Partial<SelectQueryBuilder<any>> = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0])
  };
  return qb as SelectQueryBuilder<any>;
};

const createBacktest = (overrides: Partial<Backtest> = {}): Backtest => {
  const now = new Date();
  return {
    id: 'backtest-1',
    name: 'Test Backtest',
    type: BacktestType.HISTORICAL,
    status: BacktestStatus.COMPLETED,
    initialCapital: 10000,
    finalValue: 11500,
    totalReturn: 15,
    sharpeRatio: 1.5,
    maxDrawdown: 10,
    totalTrades: 50,
    winRate: 0.6,
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-12-31'),
    createdAt: now,
    completedAt: now,
    algorithm: { id: 'algo-1', name: 'Test Algorithm' } as any,
    ...overrides
  } as Backtest;
};

const createTrade = (overrides: Partial<BacktestTrade> = {}): BacktestTrade =>
  ({
    id: 'trade-1',
    type: TradeType.BUY,
    status: TradeStatus.EXECUTED,
    quantity: 1,
    price: 100,
    totalValue: 100,
    fee: 0.1,
    realizedPnL: null,
    realizedPnLPercent: null,
    executedAt: new Date(),
    signal: null,
    baseCoin: { symbol: 'BTC' } as any,
    quoteCoin: { symbol: 'USDT' } as any,
    ...overrides
  }) as BacktestTrade;

const createSignal = (overrides: Partial<BacktestSignal> = {}): BacktestSignal =>
  ({
    id: 'signal-1',
    timestamp: new Date(),
    signalType: SignalType.ENTRY,
    instrument: 'BTC/USDT',
    direction: SignalDirection.LONG,
    quantity: 1,
    price: 50000,
    reason: 'Test signal',
    confidence: 0.75,
    ...overrides
  }) as BacktestSignal;

describe('MonitoringExportService', () => {
  let service: MonitoringExportService;
  let backtestRepo: MockRepo<Backtest>;
  let tradeRepo: MockRepo<BacktestTrade>;
  let signalRepo: MockRepo<BacktestSignal>;
  let coinRepo: MockRepo<Coin>;
  let mockQueryBuilder: SelectQueryBuilder<any>;
  let coinQueryBuilder: SelectQueryBuilder<any>;

  beforeEach(async () => {
    mockQueryBuilder = createMockQueryBuilder();
    coinQueryBuilder = createMockQueryBuilder();

    backtestRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      existsBy: jest.fn().mockResolvedValue(true)
    };

    tradeRepo = {
      find: jest.fn().mockResolvedValue([])
    };

    signalRepo = {
      find: jest.fn().mockResolvedValue([])
    };

    coinRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(coinQueryBuilder)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonitoringExportService,
        { provide: getRepositoryToken(Backtest), useValue: backtestRepo },
        { provide: getRepositoryToken(BacktestTrade), useValue: tradeRepo },
        { provide: getRepositoryToken(BacktestSignal), useValue: signalRepo },
        { provide: getRepositoryToken(Coin), useValue: coinRepo }
      ]
    }).compile();

    service = module.get(MonitoringExportService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('exportBacktests', () => {
    it('returns JSON data when format is JSON', async () => {
      (mockQueryBuilder.getManyAndCount as jest.Mock).mockResolvedValueOnce([[createBacktest()], 1]);

      const result = await service.exportBacktests({}, ExportFormat.JSON);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect((result as any[])[0]).toHaveProperty('id');
    });

    it('returns CSV buffer when format is CSV', async () => {
      (mockQueryBuilder.getManyAndCount as jest.Mock).mockResolvedValueOnce([[createBacktest()], 1]);

      const result = await service.exportBacktests({}, ExportFormat.CSV);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString()).toContain('id,');
    });

    it('returns CSV with headers matching JSON export fields', async () => {
      (mockQueryBuilder.getManyAndCount as jest.Mock).mockResolvedValueOnce([[createBacktest()], 1]);

      const csvResult = await service.exportBacktests({}, ExportFormat.CSV);
      const headers = csvResult.toString().split('\n')[0];

      expect(headers).toContain('id');
      expect(headers).toContain('sharpeRatio');
      expect(headers).toContain('totalReturn');
      expect(headers).toContain('algorithmName');
    });

    it('escapes CSV values containing commas, quotes, or newlines', async () => {
      (mockQueryBuilder.getManyAndCount as jest.Mock).mockResolvedValueOnce([
        [createBacktest({ name: 'Name, with "quotes"\nand newline' })],
        1
      ]);

      const csv = (await service.exportBacktests({}, ExportFormat.CSV)).toString();

      expect(csv).toContain('"Name, with ""quotes""\nand newline"');
    });

    it('returns empty CSV buffer when no backtests match', async () => {
      (mockQueryBuilder.getManyAndCount as jest.Mock).mockResolvedValueOnce([[], 0]);

      const result = await service.exportBacktests({}, ExportFormat.CSV);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString()).toBe('');
    });

    it('handles null completedAt without throwing', async () => {
      (mockQueryBuilder.getManyAndCount as jest.Mock).mockResolvedValueOnce([
        [createBacktest({ completedAt: null as any })],
        1
      ]);

      const result = (await service.exportBacktests({}, ExportFormat.JSON)) as any[];

      expect(result[0].completedAt).toBe('');
    });
  });

  describe('exportSignals', () => {
    it('returns signals for a specific backtest', async () => {
      (signalRepo.find as jest.Mock).mockResolvedValueOnce([createSignal()]);

      const result = await service.exportSignals('bt-1', ExportFormat.JSON);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(signalRepo.find).toHaveBeenCalledWith({
        where: { backtest: { id: 'bt-1' } },
        order: { timestamp: 'ASC' }
      });
    });

    it('throws NotFoundException when backtest does not exist', async () => {
      (backtestRepo.existsBy as jest.Mock).mockResolvedValueOnce(false);

      await expect(service.exportSignals('nonexistent-id', ExportFormat.JSON)).rejects.toThrow(NotFoundException);
    });

    it('resolves instrument UUIDs to uppercase coin symbols', async () => {
      const uuid = '11111111-1111-1111-1111-111111111111';
      (signalRepo.find as jest.Mock).mockResolvedValueOnce([createSignal({ instrument: uuid })]);
      (coinQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce([{ id: uuid, symbol: 'btc' }]);

      const result = (await service.exportSignals('bt-1', ExportFormat.JSON)) as any[];

      expect(result[0].instrument).toBe('BTC');
    });
  });

  describe('exportTrades', () => {
    it('returns trades for a specific backtest', async () => {
      (tradeRepo.find as jest.Mock).mockResolvedValueOnce([createTrade()]);

      const result = await service.exportTrades('bt-1', ExportFormat.JSON);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(tradeRepo.find).toHaveBeenCalledWith({
        where: { backtest: { id: 'bt-1' } },
        relations: ['baseCoin', 'quoteCoin'],
        order: { executedAt: 'ASC' }
      });
    });

    it('throws NotFoundException when backtest does not exist', async () => {
      (backtestRepo.existsBy as jest.Mock).mockResolvedValueOnce(false);

      await expect(service.exportTrades('nonexistent-id', ExportFormat.JSON)).rejects.toThrow(NotFoundException);
    });
  });
});
