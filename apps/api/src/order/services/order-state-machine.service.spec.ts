import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { OrderStateMachineService } from './order-state-machine.service';

import { OrderStatusHistory, OrderTransitionReason } from '../entities/order-status-history.entity';
import { OrderStatus } from '../order.entity';

describe('OrderStateMachineService', () => {
  let service: OrderStateMachineService;
  let mockHistoryRepository: any;
  let loggerWarnSpy: jest.SpyInstance;
  let loggerDebugSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;

  const mockOrderId = 'test-order-id';

  beforeEach(async () => {
    mockHistoryRepository = {
      create: jest.fn((data) => data),
      save: jest.fn((data) => Promise.resolve({ id: 'history-id', transitionedAt: new Date(), ...data })),
      find: jest.fn(),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderStateMachineService,
        {
          provide: getRepositoryToken(OrderStatusHistory),
          useValue: mockHistoryRepository
        }
      ]
    }).compile();

    service = module.get<OrderStateMachineService>(OrderStateMachineService);

    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    loggerDebugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('isValidTransition', () => {
    describe('initial creation (null -> status)', () => {
      it('should allow null -> NEW (initial creation)', () => {
        expect(service.isValidTransition(null, OrderStatus.NEW)).toBe(true);
      });

      it('should reject null -> FILLED', () => {
        expect(service.isValidTransition(null, OrderStatus.FILLED)).toBe(false);
      });

      it('should reject null -> CANCELED', () => {
        expect(service.isValidTransition(null, OrderStatus.CANCELED)).toBe(false);
      });

      it('should reject null -> PARTIALLY_FILLED', () => {
        expect(service.isValidTransition(null, OrderStatus.PARTIALLY_FILLED)).toBe(false);
      });

      it('should reject null -> REJECTED', () => {
        expect(service.isValidTransition(null, OrderStatus.REJECTED)).toBe(false);
      });

      it('should reject null -> EXPIRED', () => {
        expect(service.isValidTransition(null, OrderStatus.EXPIRED)).toBe(false);
      });

      it('should reject null -> PENDING_CANCEL', () => {
        expect(service.isValidTransition(null, OrderStatus.PENDING_CANCEL)).toBe(false);
      });
    });

    describe('same status (no-op)', () => {
      it('should allow NEW -> NEW', () => {
        expect(service.isValidTransition(OrderStatus.NEW, OrderStatus.NEW)).toBe(true);
      });

      it('should allow FILLED -> FILLED', () => {
        expect(service.isValidTransition(OrderStatus.FILLED, OrderStatus.FILLED)).toBe(true);
      });

      it('should allow CANCELED -> CANCELED', () => {
        expect(service.isValidTransition(OrderStatus.CANCELED, OrderStatus.CANCELED)).toBe(true);
      });
    });

    describe('transitions from NEW', () => {
      it('should allow NEW -> PARTIALLY_FILLED', () => {
        expect(service.isValidTransition(OrderStatus.NEW, OrderStatus.PARTIALLY_FILLED)).toBe(true);
      });

      it('should allow NEW -> FILLED', () => {
        expect(service.isValidTransition(OrderStatus.NEW, OrderStatus.FILLED)).toBe(true);
      });

      it('should allow NEW -> CANCELED', () => {
        expect(service.isValidTransition(OrderStatus.NEW, OrderStatus.CANCELED)).toBe(true);
      });

      it('should allow NEW -> REJECTED', () => {
        expect(service.isValidTransition(OrderStatus.NEW, OrderStatus.REJECTED)).toBe(true);
      });

      it('should allow NEW -> EXPIRED', () => {
        expect(service.isValidTransition(OrderStatus.NEW, OrderStatus.EXPIRED)).toBe(true);
      });

      it('should allow NEW -> PENDING_CANCEL', () => {
        expect(service.isValidTransition(OrderStatus.NEW, OrderStatus.PENDING_CANCEL)).toBe(true);
      });
    });

    describe('transitions from PARTIALLY_FILLED', () => {
      it('should allow PARTIALLY_FILLED -> FILLED', () => {
        expect(service.isValidTransition(OrderStatus.PARTIALLY_FILLED, OrderStatus.FILLED)).toBe(true);
      });

      it('should allow PARTIALLY_FILLED -> CANCELED', () => {
        expect(service.isValidTransition(OrderStatus.PARTIALLY_FILLED, OrderStatus.CANCELED)).toBe(true);
      });

      it('should allow PARTIALLY_FILLED -> PENDING_CANCEL', () => {
        expect(service.isValidTransition(OrderStatus.PARTIALLY_FILLED, OrderStatus.PENDING_CANCEL)).toBe(true);
      });

      it('should reject PARTIALLY_FILLED -> NEW', () => {
        expect(service.isValidTransition(OrderStatus.PARTIALLY_FILLED, OrderStatus.NEW)).toBe(false);
      });

      it('should reject PARTIALLY_FILLED -> REJECTED', () => {
        expect(service.isValidTransition(OrderStatus.PARTIALLY_FILLED, OrderStatus.REJECTED)).toBe(false);
      });

      it('should reject PARTIALLY_FILLED -> EXPIRED', () => {
        expect(service.isValidTransition(OrderStatus.PARTIALLY_FILLED, OrderStatus.EXPIRED)).toBe(false);
      });
    });

    describe('transitions from PENDING_CANCEL', () => {
      it('should allow PENDING_CANCEL -> CANCELED', () => {
        expect(service.isValidTransition(OrderStatus.PENDING_CANCEL, OrderStatus.CANCELED)).toBe(true);
      });

      it('should allow PENDING_CANCEL -> FILLED (can still fill while cancel pending)', () => {
        expect(service.isValidTransition(OrderStatus.PENDING_CANCEL, OrderStatus.FILLED)).toBe(true);
      });

      it('should reject PENDING_CANCEL -> NEW', () => {
        expect(service.isValidTransition(OrderStatus.PENDING_CANCEL, OrderStatus.NEW)).toBe(false);
      });

      it('should reject PENDING_CANCEL -> PARTIALLY_FILLED', () => {
        expect(service.isValidTransition(OrderStatus.PENDING_CANCEL, OrderStatus.PARTIALLY_FILLED)).toBe(false);
      });
    });

    describe('terminal states (no outgoing transitions)', () => {
      it('should reject FILLED -> any other status', () => {
        expect(service.isValidTransition(OrderStatus.FILLED, OrderStatus.NEW)).toBe(false);
        expect(service.isValidTransition(OrderStatus.FILLED, OrderStatus.CANCELED)).toBe(false);
        expect(service.isValidTransition(OrderStatus.FILLED, OrderStatus.PARTIALLY_FILLED)).toBe(false);
      });

      it('should reject CANCELED -> any other status', () => {
        expect(service.isValidTransition(OrderStatus.CANCELED, OrderStatus.NEW)).toBe(false);
        expect(service.isValidTransition(OrderStatus.CANCELED, OrderStatus.FILLED)).toBe(false);
      });

      it('should reject REJECTED -> any other status', () => {
        expect(service.isValidTransition(OrderStatus.REJECTED, OrderStatus.NEW)).toBe(false);
        expect(service.isValidTransition(OrderStatus.REJECTED, OrderStatus.FILLED)).toBe(false);
      });

      it('should reject EXPIRED -> any other status', () => {
        expect(service.isValidTransition(OrderStatus.EXPIRED, OrderStatus.NEW)).toBe(false);
        expect(service.isValidTransition(OrderStatus.EXPIRED, OrderStatus.FILLED)).toBe(false);
      });
    });
  });

  describe('isTerminalState', () => {
    it('should identify FILLED as terminal', () => {
      expect(service.isTerminalState(OrderStatus.FILLED)).toBe(true);
    });

    it('should identify CANCELED as terminal', () => {
      expect(service.isTerminalState(OrderStatus.CANCELED)).toBe(true);
    });

    it('should identify REJECTED as terminal', () => {
      expect(service.isTerminalState(OrderStatus.REJECTED)).toBe(true);
    });

    it('should identify EXPIRED as terminal', () => {
      expect(service.isTerminalState(OrderStatus.EXPIRED)).toBe(true);
    });

    it('should NOT identify NEW as terminal', () => {
      expect(service.isTerminalState(OrderStatus.NEW)).toBe(false);
    });

    it('should NOT identify PARTIALLY_FILLED as terminal', () => {
      expect(service.isTerminalState(OrderStatus.PARTIALLY_FILLED)).toBe(false);
    });

    it('should NOT identify PENDING_CANCEL as terminal', () => {
      expect(service.isTerminalState(OrderStatus.PENDING_CANCEL)).toBe(false);
    });
  });

  describe('transitionStatus', () => {
    it('should record valid transitions and return valid=true', async () => {
      const result = await service.transitionStatus(
        mockOrderId,
        OrderStatus.NEW,
        OrderStatus.FILLED,
        OrderTransitionReason.EXCHANGE_SYNC,
        { exchangeOrderId: '123' }
      );

      expect(result.valid).toBe(true);
      expect(result.fromStatus).toBe(OrderStatus.NEW);
      expect(result.toStatus).toBe(OrderStatus.FILLED);
      expect(result.reason).toBe(OrderTransitionReason.EXCHANGE_SYNC);
      expect(mockHistoryRepository.save).toHaveBeenCalled();
      expect(loggerWarnSpy).not.toHaveBeenCalled();
      expect(loggerDebugSpy).toHaveBeenCalled();
    });

    it('should record invalid transitions, log warning, but still save', async () => {
      const result = await service.transitionStatus(
        mockOrderId,
        OrderStatus.FILLED,
        OrderStatus.NEW,
        OrderTransitionReason.EXCHANGE_SYNC
      );

      expect(result.valid).toBe(false);
      expect(mockHistoryRepository.save).toHaveBeenCalled();
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid order state transition'),
        expect.any(Object)
      );
    });

    it('should mark invalid transitions in metadata', async () => {
      await service.transitionStatus(
        mockOrderId,
        OrderStatus.FILLED,
        OrderStatus.NEW,
        OrderTransitionReason.EXCHANGE_SYNC
      );

      expect(mockHistoryRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            invalidTransition: true
          })
        })
      );
    });

    it('should preserve metadata while marking invalid transitions', async () => {
      const metadata = { algorithmId: 'algo-123' };

      await service.transitionStatus(
        mockOrderId,
        OrderStatus.FILLED,
        OrderStatus.NEW,
        OrderTransitionReason.EXCHANGE_SYNC,
        metadata
      );

      expect(mockHistoryRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            algorithmId: 'algo-123',
            invalidTransition: true
          })
        })
      );
    });

    it('should include provided metadata in history record', async () => {
      const metadata = { algorithmId: 'algo-123', slippage: 0.5 };

      await service.transitionStatus(
        mockOrderId,
        OrderStatus.NEW,
        OrderStatus.FILLED,
        OrderTransitionReason.TRADE_EXECUTION,
        metadata
      );

      expect(mockHistoryRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            algorithmId: 'algo-123',
            slippage: 0.5
          })
        })
      );
    });

    it('should handle null metadata for valid transitions', async () => {
      await service.transitionStatus(
        mockOrderId,
        OrderStatus.NEW,
        OrderStatus.FILLED,
        OrderTransitionReason.EXCHANGE_SYNC
      );

      expect(mockHistoryRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: null
        })
      );
    });

    it('should record initial creation (null -> NEW)', async () => {
      const result = await service.transitionStatus(
        mockOrderId,
        null,
        OrderStatus.NEW,
        OrderTransitionReason.TRADE_EXECUTION,
        { symbol: 'BTC/USDT' }
      );

      expect(result.valid).toBe(true);
      expect(result.fromStatus).toBeNull();
      expect(result.toStatus).toBe(OrderStatus.NEW);
      expect(mockHistoryRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fromStatus: null,
          toStatus: OrderStatus.NEW
        })
      );
    });

    it('should return the saved history record', async () => {
      const createdRecord = {
        orderId: mockOrderId,
        fromStatus: OrderStatus.NEW,
        toStatus: OrderStatus.FILLED,
        reason: OrderTransitionReason.EXCHANGE_SYNC,
        metadata: null
      };
      const savedRecord = {
        id: 'history-id',
        transitionedAt: new Date('2024-01-01T00:00:00Z'),
        ...createdRecord
      };
      mockHistoryRepository.create.mockReturnValueOnce(createdRecord);
      mockHistoryRepository.save.mockResolvedValueOnce(savedRecord);

      const result = await service.transitionStatus(
        mockOrderId,
        OrderStatus.NEW,
        OrderStatus.FILLED,
        OrderTransitionReason.EXCHANGE_SYNC
      );

      expect(mockHistoryRepository.save).toHaveBeenCalledWith(createdRecord);
      expect(result.historyRecord).toEqual(savedRecord);
    });

    it('should handle repository save errors gracefully', async () => {
      const error = new Error('Database connection failed');
      mockHistoryRepository.save.mockRejectedValue(error);

      await expect(
        service.transitionStatus(mockOrderId, OrderStatus.NEW, OrderStatus.FILLED, OrderTransitionReason.EXCHANGE_SYNC)
      ).rejects.toThrow('Database connection failed');

      expect(loggerErrorSpy).toHaveBeenCalled();
    });
  });

  describe('getOrderHistory', () => {
    it('should return history ordered by transitionedAt ASC', async () => {
      const mockHistory = [
        { id: '1', fromStatus: null, toStatus: OrderStatus.NEW, transitionedAt: new Date('2024-01-01') },
        { id: '2', fromStatus: OrderStatus.NEW, toStatus: OrderStatus.FILLED, transitionedAt: new Date('2024-01-02') }
      ];
      mockHistoryRepository.find.mockResolvedValue(mockHistory);

      const result = await service.getOrderHistory(mockOrderId);

      expect(mockHistoryRepository.find).toHaveBeenCalledWith({
        where: { orderId: mockOrderId },
        order: { transitionedAt: 'ASC' }
      });
      expect(result).toEqual(mockHistory);
    });

    it('should return empty array when no history', async () => {
      mockHistoryRepository.find.mockResolvedValue([]);

      const result = await service.getOrderHistory(mockOrderId);

      expect(result).toEqual([]);
    });
  });

  describe('getLatestTransition', () => {
    it('should return the most recent transition', async () => {
      const mockTransition = {
        id: '1',
        fromStatus: OrderStatus.NEW,
        toStatus: OrderStatus.FILLED,
        transitionedAt: new Date()
      };
      mockHistoryRepository.findOne.mockResolvedValue(mockTransition);

      const result = await service.getLatestTransition(mockOrderId);

      expect(mockHistoryRepository.findOne).toHaveBeenCalledWith({
        where: { orderId: mockOrderId },
        order: { transitionedAt: 'DESC' }
      });
      expect(result).toEqual(mockTransition);
    });

    it('should return null when no transitions exist', async () => {
      mockHistoryRepository.findOne.mockResolvedValue(null);

      const result = await service.getLatestTransition(mockOrderId);

      expect(result).toBeNull();
    });
  });

  describe('countTransitionsByReason', () => {
    let mockQueryBuilder: any;

    beforeEach(() => {
      mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawMany: jest.fn()
      };
      mockHistoryRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);
    });

    it('should return counts by reason', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { reason: OrderTransitionReason.EXCHANGE_SYNC, count: '100' },
        { reason: OrderTransitionReason.TRADE_EXECUTION, count: '50' }
      ]);

      const result = await service.countTransitionsByReason();

      expect(result).toEqual({
        [OrderTransitionReason.EXCHANGE_SYNC]: 100,
        [OrderTransitionReason.TRADE_EXECUTION]: 50
      });
    });

    it('should filter by date range when provided', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      await service.countTransitionsByReason(startDate, endDate);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('history.transitionedAt >= :startDate', { startDate });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('history.transitionedAt <= :endDate', { endDate });
    });

    it('should return empty object when no data', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      const result = await service.countTransitionsByReason();

      expect(result).toEqual({});
    });
  });

  describe('findInvalidTransitions', () => {
    let mockQueryBuilder: any;

    beforeEach(() => {
      mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn()
      };
      mockHistoryRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);
    });

    it('should find transitions with invalidTransition metadata', async () => {
      const mockInvalidTransitions = [
        { id: '1', fromStatus: OrderStatus.FILLED, toStatus: OrderStatus.NEW, metadata: { invalidTransition: true } }
      ];
      mockQueryBuilder.getMany.mockResolvedValue(mockInvalidTransitions);

      const result = await service.findInvalidTransitions();

      expect(mockQueryBuilder.where).toHaveBeenCalledWith("history.metadata->>'invalidTransition' = 'true'");
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('history.transitionedAt', 'DESC');
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(100);
      expect(result).toEqual(mockInvalidTransitions);
    });

    it('should respect custom limit', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([]);

      await service.findInvalidTransitions(50);

      expect(mockQueryBuilder.take).toHaveBeenCalledWith(50);
    });
  });

  describe('getValidNextStates', () => {
    it('should return valid next states for NEW', () => {
      const nextStates = service.getValidNextStates(OrderStatus.NEW);

      expect(nextStates).toContain(OrderStatus.PARTIALLY_FILLED);
      expect(nextStates).toContain(OrderStatus.FILLED);
      expect(nextStates).toContain(OrderStatus.CANCELED);
      expect(nextStates).toContain(OrderStatus.REJECTED);
      expect(nextStates).toContain(OrderStatus.EXPIRED);
      expect(nextStates).toContain(OrderStatus.PENDING_CANCEL);
      expect(nextStates).toHaveLength(6);
    });

    it('should return valid next states for PARTIALLY_FILLED', () => {
      const nextStates = service.getValidNextStates(OrderStatus.PARTIALLY_FILLED);

      expect(nextStates).toContain(OrderStatus.FILLED);
      expect(nextStates).toContain(OrderStatus.CANCELED);
      expect(nextStates).toContain(OrderStatus.PENDING_CANCEL);
      expect(nextStates).toHaveLength(3);
    });

    it('should return valid next states for PENDING_CANCEL', () => {
      const nextStates = service.getValidNextStates(OrderStatus.PENDING_CANCEL);

      expect(nextStates).toContain(OrderStatus.CANCELED);
      expect(nextStates).toContain(OrderStatus.FILLED);
      expect(nextStates).toHaveLength(2);
    });

    it('should return empty array for terminal states', () => {
      expect(service.getValidNextStates(OrderStatus.FILLED)).toEqual([]);
      expect(service.getValidNextStates(OrderStatus.CANCELED)).toEqual([]);
      expect(service.getValidNextStates(OrderStatus.REJECTED)).toEqual([]);
      expect(service.getValidNextStates(OrderStatus.EXPIRED)).toEqual([]);
    });
  });
});
