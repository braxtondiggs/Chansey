import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { OrderCleanupService } from './order-cleanup.service';

import { OrderCleanupConfig, orderCleanupConfig } from '../config/order-cleanup.config';
import { OpportunitySellEvaluation } from '../entities/opportunity-sell-evaluation.entity';
import { PositionExit } from '../entities/position-exit.entity';
import { Order, OrderStatus } from '../order.entity';

describe('OrderCleanupService', () => {
  let service: OrderCleanupService;

  const defaultConfig: OrderCleanupConfig = {
    enabled: true,
    terminalRetentionDays: 90,
    stalePendingCancelDays: 30,
    batchSize: 500,
    batchDelayMs: 0, // no delay in tests
    evaluationRetentionDays: 90,
    dryRun: false
  };

  let config: OrderCleanupConfig;

  // Query builder mocks for order repo
  const mockOrderQb = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([])
  };

  const mockOrderRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(mockOrderQb)
  };

  // Query builder mocks for position exit repo
  const mockPeQb = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
    getCount: jest.fn().mockResolvedValue(0)
  };

  const mockPositionExitRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(mockPeQb)
  };

  // Query builder mocks for evaluation repo
  const mockEvalQb = {
    where: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(0),
    delete: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 0 })
  };

  const mockEvaluationRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(mockEvalQb)
  };

  // Transaction manager mocks
  const mockTxUpdateQb = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 0 })
  };

  const mockTxDeleteQb = {
    delete: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 0 })
  };

  const mockTransactionManager = {
    createQueryBuilder: jest.fn()
  };

  const mockDataSource = {
    transaction: jest.fn()
  };

  beforeEach(async () => {
    config = { ...defaultConfig };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderCleanupService,
        { provide: getRepositoryToken(Order), useValue: mockOrderRepo },
        { provide: getRepositoryToken(PositionExit), useValue: mockPositionExitRepo },
        { provide: getRepositoryToken(OpportunitySellEvaluation), useValue: mockEvaluationRepo },
        { provide: DataSource, useValue: mockDataSource },
        { provide: orderCleanupConfig.KEY, useFactory: () => config }
      ]
    }).compile();

    service = module.get<OrderCleanupService>(OrderCleanupService);

    jest.clearAllMocks();

    // Reset default mock returns
    mockOrderQb.getMany.mockResolvedValue([]);
    mockOrderRepo.createQueryBuilder.mockReturnValue(mockOrderQb);
    mockPeQb.getMany.mockResolvedValue([]);
    mockPeQb.getCount.mockResolvedValue(0);
    mockPositionExitRepo.createQueryBuilder.mockReturnValue(mockPeQb);
    mockEvalQb.getCount.mockResolvedValue(0);
    mockEvalQb.execute.mockResolvedValue({ affected: 0 });
    mockEvaluationRepo.createQueryBuilder.mockReturnValue(mockEvalQb);
    mockTxUpdateQb.execute.mockResolvedValue({ affected: 0 });
    mockTxDeleteQb.execute.mockResolvedValue({ affected: 0 });

    // Default transaction implementation: execute the callback
    mockDataSource.transaction.mockImplementation(async (cb: any) => cb(mockTransactionManager));

    // Default transaction manager query builder behavior
    // Calls 1-3 = UPDATE (null out SL, TP, trailing FKs), calls 4-5 = DELETE PositionExits + Orders
    let txQbCallCount = 0;
    mockTransactionManager.createQueryBuilder.mockImplementation(() => {
      txQbCallCount++;
      if (txQbCallCount <= 3) return mockTxUpdateQb;
      return mockTxDeleteQb;
    });
  });

  describe('cleanup disabled', () => {
    it('should return immediately when config.enabled is false', async () => {
      config.enabled = false;

      const result = await service.cleanup();

      expect(result.deletedOrders).toBe(0);
      expect(result.nulledPositionExitRefs).toBe(0);
      expect(result.deletedPositionExits).toBe(0);
      expect(result.skippedActiveRefs).toBe(0);
      expect(result.deletedEvaluations).toBe(0);
      expect(mockOrderRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('empty result set', () => {
    it('should handle zero candidates gracefully', async () => {
      mockOrderQb.getMany.mockResolvedValue([]);

      const result = await service.cleanup();

      expect(result.deletedOrders).toBe(0);
      expect(result.nulledPositionExitRefs).toBe(0);
      expect(result.deletedPositionExits).toBe(0);
      expect(result.skippedActiveRefs).toBe(0);
      expect(result.deletedEvaluations).toBe(0);
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('terminal order cleanup', () => {
    it('should delete old CANCELED/REJECTED/EXPIRED orders beyond retention', async () => {
      const oldOrders = [{ id: 'order-1' }, { id: 'order-2' }, { id: 'order-3' }];

      // First call: terminal orders, second call: pending cancel orders
      mockOrderQb.getMany.mockResolvedValueOnce(oldOrders).mockResolvedValueOnce([]);
      // No active position exit refs
      mockPeQb.getMany.mockResolvedValue([]);

      // Transaction: update returns 0 affected, delete PE returns 0, delete orders returns 3
      mockTxUpdateQb.execute.mockResolvedValue({ affected: 0 });
      let deleteCallCount = 0;
      mockTxDeleteQb.execute.mockImplementation(async () => {
        deleteCallCount++;
        if (deleteCallCount === 1) return { affected: 0 }; // PE deletes
        return { affected: 3 }; // Order deletes
      });

      const result = await service.cleanup();

      expect(result.deletedOrders).toBe(3);
      expect(mockDataSource.transaction).toHaveBeenCalled();

      // Verify the query used correct statuses
      expect(mockOrderQb.where).toHaveBeenCalledWith('order.status IN (:...statuses)', {
        statuses: [OrderStatus.CANCELED, OrderStatus.REJECTED, OrderStatus.EXPIRED]
      });
    });

    it('should delete stale PENDING_CANCEL orders beyond 30 days', async () => {
      const staleOrders = [{ id: 'order-pc-1' }];

      // First call: no terminal orders, second call: pending cancel orders
      mockOrderQb.getMany.mockResolvedValueOnce([]).mockResolvedValueOnce(staleOrders);
      mockPeQb.getMany.mockResolvedValue([]);

      let deleteCallCount = 0;
      mockTxDeleteQb.execute.mockImplementation(async () => {
        deleteCallCount++;
        if (deleteCallCount === 1) return { affected: 0 };
        return { affected: 1 };
      });

      const result = await service.cleanup();

      expect(result.deletedOrders).toBe(1);
      expect(mockOrderQb.where).toHaveBeenCalledWith('order.status = :status', {
        status: OrderStatus.PENDING_CANCEL
      });
    });
  });

  describe('PositionExit FK handling', () => {
    it('should null out SL/TP/trailing FK refs before deleting orders', async () => {
      const oldOrders = [{ id: 'order-1' }];
      mockOrderQb.getMany.mockResolvedValueOnce(oldOrders).mockResolvedValueOnce([]);
      mockPeQb.getMany.mockResolvedValue([]);

      // 3 separate update calls: SL=1, TP=1, trailing=0
      mockTxUpdateQb.execute
        .mockResolvedValueOnce({ affected: 1 })
        .mockResolvedValueOnce({ affected: 1 })
        .mockResolvedValueOnce({ affected: 0 });
      let deleteCallCount = 0;
      mockTxDeleteQb.execute.mockImplementation(async () => {
        deleteCallCount++;
        if (deleteCallCount === 1) return { affected: 0 };
        return { affected: 1 };
      });

      const result = await service.cleanup();

      expect(result.nulledPositionExitRefs).toBe(2);
      // Verify 3 separate update calls (one per FK column)
      expect(mockTxUpdateQb.update).toHaveBeenCalledTimes(3);
      expect(mockTxUpdateQb.update).toHaveBeenCalledWith(PositionExit);
    });

    it('should delete non-active PositionExit records whose entry order is being cleaned', async () => {
      const oldOrders = [{ id: 'order-1' }];
      mockOrderQb.getMany.mockResolvedValueOnce(oldOrders).mockResolvedValueOnce([]);
      mockPeQb.getMany.mockResolvedValue([]);

      mockTxUpdateQb.execute.mockResolvedValue({ affected: 0 });
      let deleteCallCount = 0;
      mockTxDeleteQb.execute.mockImplementation(async () => {
        deleteCallCount++;
        if (deleteCallCount === 1) return { affected: 3 }; // PE deletes
        return { affected: 1 }; // Order deletes
      });

      const result = await service.cleanup();

      expect(result.deletedPositionExits).toBe(3);
    });

    it('should skip entire batch when all orders are referenced by active positions', async () => {
      const oldOrders = [{ id: 'order-1' }, { id: 'order-2' }];
      mockOrderQb.getMany.mockResolvedValueOnce(oldOrders).mockResolvedValueOnce([]);

      // Both orders are referenced by active PositionExits
      mockPeQb.getMany.mockResolvedValue([{ entryOrderId: 'order-1' }, { entryOrderId: 'order-2' }]);

      const result = await service.cleanup();

      expect(result.skippedActiveRefs).toBe(2);
      expect(result.deletedOrders).toBe(0);
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('should skip orders referenced by active PositionExit entry orders', async () => {
      const oldOrders = [{ id: 'order-1' }, { id: 'order-2' }];
      mockOrderQb.getMany.mockResolvedValueOnce(oldOrders).mockResolvedValueOnce([]);

      // order-1 is referenced by an active PositionExit
      mockPeQb.getMany.mockResolvedValue([{ entryOrderId: 'order-1' }]);

      let deleteCallCount = 0;
      mockTxDeleteQb.execute.mockImplementation(async () => {
        deleteCallCount++;
        if (deleteCallCount === 1) return { affected: 0 };
        return { affected: 1 }; // Only order-2 deleted
      });

      const result = await service.cleanup();

      expect(result.skippedActiveRefs).toBe(1);
      expect(result.deletedOrders).toBe(1);
    });
  });

  describe('dry-run mode', () => {
    it('should report what would be deleted without executing transactions', async () => {
      config.dryRun = true;

      const oldOrders = [{ id: 'order-1' }, { id: 'order-2' }];
      mockOrderQb.getMany.mockResolvedValueOnce(oldOrders).mockResolvedValueOnce([]);
      mockPeQb.getMany.mockResolvedValue([]); // No active refs
      mockPeQb.getCount.mockResolvedValueOnce(1).mockResolvedValueOnce(2); // nullable refs count, deletable exits count

      const result = await service.cleanup();

      expect(result.dryRun).toBe(true);
      expect(result.deletedOrders).toBe(2);
      expect(result.nulledPositionExitRefs).toBe(1);
      expect(result.deletedPositionExits).toBe(2);
      expect(result.skippedActiveRefs).toBe(0);
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('should exclude active-ref orders from dry-run counts', async () => {
      config.dryRun = true;

      const oldOrders = [{ id: 'order-1' }, { id: 'order-2' }, { id: 'order-3' }];
      mockOrderQb.getMany.mockResolvedValueOnce(oldOrders).mockResolvedValueOnce([]);

      // order-2 is referenced by an active PositionExit
      mockPeQb.getMany.mockResolvedValue([{ entryOrderId: 'order-2' }]);
      mockPeQb.getCount.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      const result = await service.cleanup();

      expect(result.dryRun).toBe(true);
      expect(result.skippedActiveRefs).toBe(1);
      expect(result.deletedOrders).toBe(2); // only order-1 and order-3
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('batch processing', () => {
    it('should process multiple batches correctly', async () => {
      config.batchSize = 2;

      const oldOrders = [{ id: 'order-1' }, { id: 'order-2' }, { id: 'order-3' }];
      mockOrderQb.getMany.mockResolvedValueOnce(oldOrders).mockResolvedValueOnce([]);
      mockPeQb.getMany.mockResolvedValue([]);

      let txCallCount = 0;
      mockDataSource.transaction.mockImplementation(async (cb: any) => {
        txCallCount++;
        // Reset the call count tracker for each transaction
        let innerCallCount = 0;
        const currentTx = txCallCount;
        const innerTxManager = {
          createQueryBuilder: jest.fn().mockImplementation(() => {
            innerCallCount++;
            // Calls 1-3 = UPDATE (null out SL, TP, trailing FKs)
            if (innerCallCount <= 3) {
              return {
                update: jest.fn().mockReturnThis(),
                set: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                execute: jest.fn().mockResolvedValue({ affected: 0 })
              };
            }
            // Calls 4-5 = DELETE PositionExits + Orders
            return {
              delete: jest.fn().mockReturnThis(),
              from: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              execute: jest.fn().mockResolvedValue({
                affected: currentTx === 1 ? (innerCallCount === 4 ? 0 : 2) : innerCallCount === 4 ? 0 : 1
              })
            };
          })
        };
        return cb(innerTxManager);
      });

      const result = await service.cleanup();

      // 2 transactions: first batch of 2, second batch of 1
      expect(mockDataSource.transaction).toHaveBeenCalledTimes(2);
      expect(result.deletedOrders).toBe(3);
    });
  });

  describe('transaction failure', () => {
    it('should propagate transaction errors', async () => {
      const oldOrders = [{ id: 'order-1' }];
      mockOrderQb.getMany.mockResolvedValueOnce(oldOrders).mockResolvedValueOnce([]);
      mockPeQb.getMany.mockResolvedValue([]);

      mockDataSource.transaction.mockRejectedValue(new Error('DB connection lost'));

      await expect(service.cleanup()).rejects.toThrow('DB connection lost');
    });
  });
});
