import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { BacktestFinalMetrics, BacktestResultService } from './backtest-result.service';
import { BacktestStreamService } from './backtest-stream.service';
import {
  Backtest,
  BacktestPerformanceSnapshot,
  BacktestSignal,
  BacktestStatus,
  BacktestTrade,
  SimulatedOrderFill
} from './backtest.entity';

describe('BacktestResultService', () => {
  let service: BacktestResultService;

  const mockBacktestRepository = {
    save: jest.fn(),
    update: jest.fn()
  };

  const mockBacktestStreamService = {
    publishStatus: jest.fn()
  };

  const mockBacktestTradeRepository = {
    count: jest.fn(),
    find: jest.fn(),
    remove: jest.fn()
  };

  const mockBacktestSignalRepository = {
    count: jest.fn(),
    find: jest.fn(),
    remove: jest.fn()
  };

  const mockSimulatedFillRepository = {
    count: jest.fn(),
    find: jest.fn(),
    remove: jest.fn()
  };

  const mockBacktestSnapshotRepository = {
    count: jest.fn(),
    find: jest.fn(),
    remove: jest.fn()
  };

  // Mock QueryRunner for transaction testing
  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: {
      save: jest.fn()
    }
  };

  const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner)
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BacktestResultService,
        { provide: getRepositoryToken(Backtest), useValue: mockBacktestRepository },
        { provide: getRepositoryToken(BacktestTrade), useValue: mockBacktestTradeRepository },
        { provide: getRepositoryToken(BacktestSignal), useValue: mockBacktestSignalRepository },
        { provide: getRepositoryToken(SimulatedOrderFill), useValue: mockSimulatedFillRepository },
        { provide: getRepositoryToken(BacktestPerformanceSnapshot), useValue: mockBacktestSnapshotRepository },
        { provide: DataSource, useValue: mockDataSource },
        { provide: BacktestStreamService, useValue: mockBacktestStreamService }
      ]
    }).compile();

    service = module.get<BacktestResultService>(BacktestResultService);

    jest.clearAllMocks();
    mockDataSource.createQueryRunner.mockReturnValue(mockQueryRunner);

    (service as any).backtestTradeRepository = mockBacktestTradeRepository;
    (service as any).backtestSignalRepository = mockBacktestSignalRepository;
    (service as any).simulatedFillRepository = mockSimulatedFillRepository;
    (service as any).backtestSnapshotRepository = mockBacktestSnapshotRepository;
  });

  describe('persistSuccess', () => {
    const mockBacktest = {
      id: 'backtest-123',
      status: BacktestStatus.RUNNING
    } as Backtest;

    const mockFinalMetrics: BacktestFinalMetrics = {
      finalValue: 11000,
      totalReturn: 10,
      annualizedReturn: 15,
      sharpeRatio: 1.5,
      maxDrawdown: -5,
      totalTrades: 10,
      winningTrades: 6,
      winRate: 60
    };

    const mockResults = {
      trades: [{ id: 'trade-1' }, { id: 'trade-2' }] as Partial<BacktestTrade>[],
      signals: [{ id: 'signal-1' }] as Partial<BacktestSignal>[],
      simulatedFills: [{ id: 'fill-1' }] as Partial<SimulatedOrderFill>[],
      snapshots: [{ id: 'snapshot-1' }] as Partial<BacktestPerformanceSnapshot>[],
      finalMetrics: mockFinalMetrics
    };

    it('should persist results, commit, and publish after the transaction', async () => {
      mockQueryRunner.manager.save.mockResolvedValue({});

      await service.persistSuccess(mockBacktest, mockResults);

      expect(mockDataSource.createQueryRunner).toHaveBeenCalled();
      expect(mockQueryRunner.connect).toHaveBeenCalled();
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();

      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(BacktestSignal, mockResults.signals);
      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(SimulatedOrderFill, mockResults.simulatedFills);
      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(BacktestTrade, mockResults.trades);
      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(BacktestPerformanceSnapshot, mockResults.snapshots);
      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(
        Backtest,
        expect.objectContaining({
          id: 'backtest-123',
          finalValue: 11000,
          totalReturn: 10,
          annualizedReturn: 15,
          sharpeRatio: 1.5,
          maxDrawdown: -5,
          totalTrades: 10,
          winningTrades: 6,
          winRate: 60,
          status: BacktestStatus.COMPLETED,
          completedAt: expect.any(Date)
        })
      );

      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.rollbackTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();

      const commitOrder = mockQueryRunner.commitTransaction.mock.invocationCallOrder[0];
      const publishOrder = mockBacktestStreamService.publishStatus.mock.invocationCallOrder[0];

      expect(commitOrder).toBeLessThan(publishOrder);
      expect(mockBacktestStreamService.publishStatus).toHaveBeenCalledWith('backtest-123', 'completed');
    });

    it('should rollback, release, and rethrow without publishing on failure', async () => {
      const saveError = new Error('Database connection lost');
      mockQueryRunner.manager.save.mockRejectedValue(saveError);

      await expect(service.persistSuccess(mockBacktest, mockResults)).rejects.toThrow(saveError);

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
      expect(mockBacktestStreamService.publishStatus).not.toHaveBeenCalled();
    });

    it('should rollback when a later save fails', async () => {
      const saveError = new Error('Trade save failed');
      mockQueryRunner.manager.save
        .mockResolvedValueOnce({}) // signals succeed
        .mockResolvedValueOnce({}) // fills succeed
        .mockRejectedValueOnce(saveError); // trades fail

      await expect(service.persistSuccess(mockBacktest, mockResults)).rejects.toThrow(saveError);

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
      expect(mockBacktestStreamService.publishStatus).not.toHaveBeenCalled();
    });

    it('should skip saving empty arrays', async () => {
      mockQueryRunner.manager.save.mockResolvedValue({});

      const emptyResults = {
        trades: [],
        signals: [],
        simulatedFills: [],
        snapshots: [],
        finalMetrics: mockResults.finalMetrics
      };

      await service.persistSuccess(mockBacktest, emptyResults);

      // Should only save the backtest entity itself
      expect(mockQueryRunner.manager.save).toHaveBeenCalledTimes(1);
      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(Backtest, expect.any(Object));
    });
  });

  describe('markFailed', () => {
    it('should update backtest status and publish failed state', async () => {
      const backtestId = 'backtest-456';
      const errorMessage = 'Strategy execution error';

      await service.markFailed(backtestId, errorMessage);

      expect(mockBacktestRepository.update).toHaveBeenCalledWith(backtestId, {
        status: BacktestStatus.FAILED,
        errorMessage
      });
      expect(mockBacktestStreamService.publishStatus).toHaveBeenCalledWith(backtestId, 'failed', errorMessage);
    });
  });

  describe('markCancelled', () => {
    it('should update backtest status and publish cancellation', async () => {
      const mockBacktest = { id: 'backtest-789', status: BacktestStatus.RUNNING } as Backtest;
      const reason = 'User requested cancellation';
      mockBacktestRepository.save.mockResolvedValue(mockBacktest);

      await service.markCancelled(mockBacktest, reason);

      expect(mockBacktest.status).toBe(BacktestStatus.CANCELLED);
      expect(mockBacktestRepository.save).toHaveBeenCalledWith(mockBacktest);
      expect(mockBacktestStreamService.publishStatus).toHaveBeenCalledWith('backtest-789', 'cancelled', reason);
    });
  });

  describe('cleanupOrphanedResults', () => {
    it('removes excess results beyond checkpoint counts', async () => {
      mockBacktestTradeRepository.count.mockResolvedValue(3);
      mockBacktestSignalRepository.count.mockResolvedValue(1);
      mockSimulatedFillRepository.count.mockResolvedValue(2);
      mockBacktestSnapshotRepository.count.mockResolvedValue(0);

      const excessTrades = [{ id: 'trade-3' }];
      const excessFills = [{ id: 'fill-1' }, { id: 'fill-2' }];
      mockBacktestTradeRepository.find.mockResolvedValue(excessTrades);
      mockSimulatedFillRepository.find.mockResolvedValue(excessFills);

      const result = await service.cleanupOrphanedResults('backtest-1', {
        trades: 2,
        signals: 1,
        fills: 0,
        snapshots: 0
      });

      expect(mockBacktestTradeRepository.find).toHaveBeenCalledWith(expect.objectContaining({ take: 1 }));
      expect(mockBacktestTradeRepository.remove).toHaveBeenCalledWith(excessTrades);
      expect(mockSimulatedFillRepository.find).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
      expect(mockSimulatedFillRepository.remove).toHaveBeenCalledWith(excessFills);
      expect(mockBacktestSignalRepository.find).not.toHaveBeenCalled();
      expect(mockBacktestSnapshotRepository.find).not.toHaveBeenCalled();

      expect(result).toEqual({
        deleted: { trades: 1, signals: 0, fills: 2, snapshots: 0 }
      });
    });

    it('does nothing when counts match', async () => {
      mockBacktestTradeRepository.count.mockResolvedValue(1);
      mockBacktestSignalRepository.count.mockResolvedValue(1);
      mockSimulatedFillRepository.count.mockResolvedValue(1);
      mockBacktestSnapshotRepository.count.mockResolvedValue(1);

      const result = await service.cleanupOrphanedResults('backtest-2', {
        trades: 1,
        signals: 1,
        fills: 1,
        snapshots: 1
      });

      expect(mockBacktestTradeRepository.find).not.toHaveBeenCalled();
      expect(mockBacktestSignalRepository.find).not.toHaveBeenCalled();
      expect(mockSimulatedFillRepository.find).not.toHaveBeenCalled();
      expect(mockBacktestSnapshotRepository.find).not.toHaveBeenCalled();
      expect(result).toEqual({
        deleted: { trades: 0, signals: 0, fills: 0, snapshots: 0 }
      });
    });
  });

  describe('getPersistedCounts', () => {
    it('returns current persisted counts for a backtest', async () => {
      mockBacktestTradeRepository.count.mockResolvedValue(4);
      mockBacktestSignalRepository.count.mockResolvedValue(3);
      mockSimulatedFillRepository.count.mockResolvedValue(2);
      mockBacktestSnapshotRepository.count.mockResolvedValue(1);

      await expect(service.getPersistedCounts('backtest-3')).resolves.toEqual({
        trades: 4,
        signals: 3,
        fills: 2,
        snapshots: 1
      });
    });
  });
});
