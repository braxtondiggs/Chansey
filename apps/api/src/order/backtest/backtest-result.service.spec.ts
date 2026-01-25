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

import { MetricsService } from '../../metrics/metrics.service';

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
    save: jest.fn(),
    remove: jest.fn()
  };

  const mockBacktestSignalRepository = {
    count: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    remove: jest.fn()
  };

  const mockSimulatedFillRepository = {
    count: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    remove: jest.fn()
  };

  const mockBacktestSnapshotRepository = {
    count: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    remove: jest.fn()
  };

  const mockMetricsService = {
    startPersistenceTimer: jest.fn(),
    recordRecordsPersisted: jest.fn(),
    recordCheckpointOrphansCleaned: jest.fn()
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

  // Mock EntityManager for transaction callback
  const mockTransactionManager = {
    getRepository: jest.fn()
  };

  const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    transaction: jest.fn()
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
        { provide: BacktestStreamService, useValue: mockBacktestStreamService },
        { provide: MetricsService, useValue: mockMetricsService }
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
      const endTimer = jest.fn();
      mockMetricsService.startPersistenceTimer.mockReturnValue(endTimer);
      mockQueryRunner.manager.save.mockResolvedValue({});

      await service.persistSuccess(mockBacktest, mockResults);

      expect(mockMetricsService.startPersistenceTimer).toHaveBeenCalledWith('full');
      expect(mockDataSource.createQueryRunner).toHaveBeenCalled();
      expect(mockQueryRunner.connect).toHaveBeenCalled();
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();

      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(BacktestSignal, mockResults.signals);
      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(SimulatedOrderFill, mockResults.simulatedFills);
      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(BacktestTrade, mockResults.trades);
      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(BacktestPerformanceSnapshot, mockResults.snapshots);
      expect(mockMetricsService.recordRecordsPersisted).toHaveBeenCalledWith('signals', mockResults.signals.length);
      expect(mockMetricsService.recordRecordsPersisted).toHaveBeenCalledWith(
        'fills',
        mockResults.simulatedFills.length
      );
      expect(mockMetricsService.recordRecordsPersisted).toHaveBeenCalledWith('trades', mockResults.trades.length);
      expect(mockMetricsService.recordRecordsPersisted).toHaveBeenCalledWith('snapshots', mockResults.snapshots.length);
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
      expect(endTimer).toHaveBeenCalled();

      const commitOrder = mockQueryRunner.commitTransaction.mock.invocationCallOrder[0];
      const publishOrder = mockBacktestStreamService.publishStatus.mock.invocationCallOrder[0];

      expect(commitOrder).toBeLessThan(publishOrder);
      expect(mockBacktestStreamService.publishStatus).toHaveBeenCalledWith('backtest-123', 'completed');
    });

    it('should rollback, release, and rethrow without publishing on failure', async () => {
      const endTimer = jest.fn();
      mockMetricsService.startPersistenceTimer.mockReturnValue(endTimer);
      const saveError = new Error('Database connection lost');
      mockQueryRunner.manager.save.mockRejectedValue(saveError);

      await expect(service.persistSuccess(mockBacktest, mockResults)).rejects.toThrow(saveError);

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
      expect(mockBacktestStreamService.publishStatus).not.toHaveBeenCalled();
      expect(endTimer).toHaveBeenCalled();
    });

    it('should rollback when a later save fails', async () => {
      const endTimer = jest.fn();
      mockMetricsService.startPersistenceTimer.mockReturnValue(endTimer);
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
      expect(endTimer).toHaveBeenCalled();
    });

    it('should skip saving empty arrays', async () => {
      const endTimer = jest.fn();
      mockMetricsService.startPersistenceTimer.mockReturnValue(endTimer);
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
      expect(mockMetricsService.recordRecordsPersisted).not.toHaveBeenCalled();
      expect(endTimer).toHaveBeenCalled();
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

  describe('persistIncremental', () => {
    it('persists non-empty collections and records metrics', async () => {
      const endTimer = jest.fn();
      mockMetricsService.startPersistenceTimer.mockReturnValue(endTimer);

      const results = {
        trades: [{ id: 'trade-1' }],
        signals: [{ id: 'signal-1' }],
        simulatedFills: [{ id: 'fill-1' }],
        snapshots: [{ id: 'snapshot-1' }]
      };

      await service.persistIncremental({ id: 'backtest-1' } as Backtest, results);

      expect(mockBacktestTradeRepository.save).toHaveBeenCalledWith(results.trades);
      expect(mockBacktestSignalRepository.save).toHaveBeenCalledWith(results.signals);
      expect(mockSimulatedFillRepository.save).toHaveBeenCalledWith(results.simulatedFills);
      expect(mockBacktestSnapshotRepository.save).toHaveBeenCalledWith(results.snapshots);
      expect(mockMetricsService.recordRecordsPersisted).toHaveBeenCalledWith('trades', results.trades.length);
      expect(mockMetricsService.recordRecordsPersisted).toHaveBeenCalledWith('signals', results.signals.length);
      expect(mockMetricsService.recordRecordsPersisted).toHaveBeenCalledWith('fills', results.simulatedFills.length);
      expect(mockMetricsService.recordRecordsPersisted).toHaveBeenCalledWith('snapshots', results.snapshots.length);
      expect(endTimer).toHaveBeenCalled();
    });

    it('skips empty collections', async () => {
      const endTimer = jest.fn();
      mockMetricsService.startPersistenceTimer.mockReturnValue(endTimer);

      const results = {
        trades: [],
        signals: [],
        simulatedFills: [],
        snapshots: []
      };

      await service.persistIncremental({ id: 'backtest-1' } as Backtest, results);

      expect(mockBacktestTradeRepository.save).not.toHaveBeenCalled();
      expect(mockBacktestSignalRepository.save).not.toHaveBeenCalled();
      expect(mockSimulatedFillRepository.save).not.toHaveBeenCalled();
      expect(mockBacktestSnapshotRepository.save).not.toHaveBeenCalled();
      expect(mockMetricsService.recordRecordsPersisted).not.toHaveBeenCalled();
      expect(endTimer).toHaveBeenCalled();
    });
  });

  describe('saveCheckpoint', () => {
    it('updates checkpoint fields and progress counts', async () => {
      const checkpoint = { lastProcessedIndex: 10 } as any;

      await service.saveCheckpoint('backtest-1', checkpoint, 20, 100);

      expect(mockBacktestRepository.update).toHaveBeenCalledWith('backtest-1', {
        checkpointState: checkpoint,
        lastCheckpointAt: expect.any(Date),
        processedTimestampCount: 20,
        totalTimestampCount: 100
      });
    });
  });

  describe('clearCheckpoint', () => {
    it('clears checkpoint state and timestamp', async () => {
      await service.clearCheckpoint('backtest-2');

      expect(mockBacktestRepository.update).toHaveBeenCalledWith('backtest-2', {
        checkpointState: null,
        lastCheckpointAt: null
      });
    });
  });

  describe('cleanupOrphanedResults', () => {
    // Helper to create repository mocks for transaction testing
    const createMockRepo = () => ({
      count: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockResolvedValue([]),
      remove: jest.fn().mockResolvedValue(undefined)
    });

    it('removes excess results beyond checkpoint counts within a transaction', async () => {
      const mockTradeRepo = createMockRepo();
      const mockSignalRepo = createMockRepo();
      const mockFillRepo = createMockRepo();
      const mockSnapshotRepo = createMockRepo();

      // Set up counts: trades has 3 (expected 2 = 1 excess), fills has 2 (expected 0 = 2 excess)
      mockTradeRepo.count.mockResolvedValue(3);
      mockSignalRepo.count.mockResolvedValue(1);
      mockFillRepo.count.mockResolvedValue(2);
      mockSnapshotRepo.count.mockResolvedValue(0);

      const excessTrades = [{ id: 'trade-3' }];
      const excessFills = [{ id: 'fill-1' }, { id: 'fill-2' }];
      mockTradeRepo.find.mockResolvedValue(excessTrades);
      mockFillRepo.find.mockResolvedValue(excessFills);

      mockTransactionManager.getRepository
        .mockReturnValueOnce(mockTradeRepo) // First call for BacktestTrade
        .mockReturnValueOnce(mockSignalRepo) // Second call for BacktestSignal
        .mockReturnValueOnce(mockFillRepo) // Third call for SimulatedOrderFill
        .mockReturnValueOnce(mockSnapshotRepo); // Fourth call for BacktestPerformanceSnapshot

      // Make transaction execute the callback with mock manager
      mockDataSource.transaction.mockImplementation(async (cb: any) => cb(mockTransactionManager));

      const result = await service.cleanupOrphanedResults('backtest-1', {
        trades: 2,
        signals: 1,
        fills: 0,
        snapshots: 0
      });

      // Verify transaction was used
      expect(mockDataSource.transaction).toHaveBeenCalled();

      // Verify cleanup operations
      expect(mockTradeRepo.count).toHaveBeenCalledWith({ where: { backtest: { id: 'backtest-1' } } });
      expect(mockTradeRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { backtest: { id: 'backtest-1' } },
          order: { executedAt: 'DESC' },
          take: 1
        })
      );
      expect(mockTradeRepo.remove).toHaveBeenCalledWith(excessTrades);
      expect(mockFillRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { backtest: { id: 'backtest-1' } },
          order: { executionTimestamp: 'DESC' },
          take: 2
        })
      );
      expect(mockFillRepo.remove).toHaveBeenCalledWith(excessFills);

      expect(mockMetricsService.recordCheckpointOrphansCleaned).toHaveBeenCalledWith('trades', 1);
      expect(mockMetricsService.recordCheckpointOrphansCleaned).toHaveBeenCalledWith('fills', 2);
      expect(mockMetricsService.recordCheckpointOrphansCleaned).toHaveBeenCalledWith('signals', 0);
      expect(mockMetricsService.recordCheckpointOrphansCleaned).toHaveBeenCalledWith('snapshots', 0);

      expect(result).toEqual({
        deleted: { trades: 1, signals: 0, fills: 2, snapshots: 0 }
      });
    });

    it('does nothing when counts match', async () => {
      const mockTradeRepo = createMockRepo();
      const mockSignalRepo = createMockRepo();
      const mockFillRepo = createMockRepo();
      const mockSnapshotRepo = createMockRepo();

      mockTradeRepo.count.mockResolvedValue(1);
      mockSignalRepo.count.mockResolvedValue(1);
      mockFillRepo.count.mockResolvedValue(1);
      mockSnapshotRepo.count.mockResolvedValue(1);

      mockTransactionManager.getRepository
        .mockReturnValueOnce(mockTradeRepo)
        .mockReturnValueOnce(mockSignalRepo)
        .mockReturnValueOnce(mockFillRepo)
        .mockReturnValueOnce(mockSnapshotRepo);

      mockDataSource.transaction.mockImplementation(async (cb: any) => cb(mockTransactionManager));

      const result = await service.cleanupOrphanedResults('backtest-2', {
        trades: 1,
        signals: 1,
        fills: 1,
        snapshots: 1
      });

      expect(mockTradeRepo.find).not.toHaveBeenCalled();
      expect(mockSignalRepo.find).not.toHaveBeenCalled();
      expect(mockFillRepo.find).not.toHaveBeenCalled();
      expect(mockSnapshotRepo.find).not.toHaveBeenCalled();
      expect(mockMetricsService.recordCheckpointOrphansCleaned).not.toHaveBeenCalled();
      expect(result).toEqual({
        deleted: { trades: 0, signals: 0, fills: 0, snapshots: 0 }
      });
    });

    it('rolls back all changes on partial failure', async () => {
      const mockTradeRepo = createMockRepo();
      const mockSignalRepo = createMockRepo();
      const mockFillRepo = createMockRepo();
      const mockSnapshotRepo = createMockRepo();

      mockTradeRepo.count.mockResolvedValue(3);
      mockTradeRepo.find.mockResolvedValue([{ id: 'trade-1' }]);
      mockTradeRepo.remove.mockResolvedValue(undefined); // First cleanup succeeds

      mockSignalRepo.count.mockResolvedValue(3);
      mockSignalRepo.find.mockResolvedValue([{ id: 'signal-1' }]);
      mockSignalRepo.remove.mockRejectedValue(new Error('Database error')); // Second cleanup fails

      mockTransactionManager.getRepository
        .mockReturnValueOnce(mockTradeRepo)
        .mockReturnValueOnce(mockSignalRepo)
        .mockReturnValueOnce(mockFillRepo)
        .mockReturnValueOnce(mockSnapshotRepo);

      // Transaction should throw when callback throws
      mockDataSource.transaction.mockImplementation(async (cb: any) => cb(mockTransactionManager));

      await expect(
        service.cleanupOrphanedResults('backtest-3', {
          trades: 2,
          signals: 2,
          fills: 0,
          snapshots: 0
        })
      ).rejects.toThrow('Database error');

      // Verify transaction was used (it would handle the rollback)
      expect(mockDataSource.transaction).toHaveBeenCalled();
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
