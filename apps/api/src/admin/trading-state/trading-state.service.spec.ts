import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { AuditEventType } from '@chansey/api-interfaces';

import { HaltTradingDto } from './dto/halt-trading.dto';
import { ResumeTradingDto } from './dto/resume-trading.dto';
import { TradingState } from './trading-state.entity';
import { TradingStateService } from './trading-state.service';

import { AuditService } from '../../audit/audit.service';
import { Order, OrderStatus } from '../../order/order.entity';
import { OrderService } from '../../order/order.service';
import { DeploymentService } from '../../strategy/deployment.service';

type MockRepo<T> = jest.Mocked<Repository<T>>;

const createTradingState = (overrides: Partial<TradingState> = {}): TradingState => {
  const now = new Date();
  return {
    id: overrides.id ?? 'state-1',
    tradingEnabled: overrides.tradingEnabled ?? true,
    haltedAt: overrides.haltedAt ?? null,
    haltedBy: overrides.haltedBy ?? null,
    haltReason: overrides.haltReason ?? null,
    resumedAt: overrides.resumedAt ?? null,
    resumedBy: overrides.resumedBy ?? null,
    resumeReason: overrides.resumeReason ?? null,
    haltCount: overrides.haltCount ?? 0,
    metadata: overrides.metadata ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now
  } as TradingState;
};

const createOrder = (overrides: Partial<Order> = {}): Order =>
  ({
    id: overrides.id ?? 'order-1',
    status: overrides.status ?? OrderStatus.NEW,
    user: overrides.user !== undefined ? overrides.user : ({ id: 'user-1' } as any),
    exchange: overrides.exchange !== undefined ? overrides.exchange : ({ id: 'exchange-1' } as any),
    ...overrides
  }) as Order;

describe('TradingStateService', () => {
  let service: TradingStateService;
  let tradingStateRepo: MockRepo<TradingState>;
  let orderRepo: MockRepo<Order>;
  let auditService: jest.Mocked<AuditService>;
  let deploymentService: jest.Mocked<DeploymentService>;
  let orderService: jest.Mocked<OrderService>;

  beforeEach(async () => {
    tradingStateRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn()
    } as unknown as MockRepo<TradingState>;

    orderRepo = {
      find: jest.fn()
    } as unknown as MockRepo<Order>;

    auditService = {
      createAuditLog: jest.fn()
    } as unknown as jest.Mocked<AuditService>;

    deploymentService = {
      getActiveDeployments: jest.fn(),
      pauseDeployment: jest.fn()
    } as unknown as jest.Mocked<DeploymentService>;

    orderService = {
      cancelManualOrder: jest.fn()
    } as unknown as jest.Mocked<OrderService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradingStateService,
        { provide: getRepositoryToken(TradingState), useValue: tradingStateRepo },
        { provide: getRepositoryToken(Order), useValue: orderRepo },
        { provide: AuditService, useValue: auditService },
        { provide: DeploymentService, useValue: deploymentService },
        { provide: OrderService, useValue: orderService }
      ]
    }).compile();

    service = module.get(TradingStateService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('isTradingEnabled', () => {
    it('returns true when cache is empty', () => {
      expect(service.isTradingEnabled()).toBe(true);
      expect(tradingStateRepo.findOne).not.toHaveBeenCalled();
    });

    it('returns cached trading state value', () => {
      (service as any).cachedState = createTradingState({ tradingEnabled: false });

      expect(service.isTradingEnabled()).toBe(false);
      expect(tradingStateRepo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('haltTrading', () => {
    it('transitions trading state and writes audit log', async () => {
      const state = createTradingState({ tradingEnabled: true, haltCount: 2, metadata: { source: 'seed' } });
      tradingStateRepo.findOne.mockResolvedValueOnce(state);
      tradingStateRepo.save.mockImplementation(async (saved) => saved as TradingState);
      tradingStateRepo.findOne.mockResolvedValueOnce(state);

      const dto: HaltTradingDto = {
        reason: 'Market volatility spike detected',
        metadata: { triggerSource: 'admin' }
      };

      const result = await service.haltTrading('admin-1', dto);

      expect(result.tradingEnabled).toBe(false);
      expect(result.haltedAt).toEqual(expect.any(Date));
      expect(result.haltedBy).toBe('admin-1');
      expect(result.haltReason).toBe(dto.reason);
      expect(result.haltCount).toBe(3);
      expect(result.metadata).toEqual(
        expect.objectContaining({
          source: 'seed',
          lastHaltMetadata: dto.metadata,
          haltSource: 'manual'
        })
      );
      expect(tradingStateRepo.save).toHaveBeenCalledTimes(1);
      expect(auditService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.MANUAL_INTERVENTION,
          entityType: 'TradingState',
          userId: 'admin-1',
          metadata: {
            action: 'halt_trading',
            reason: dto.reason,
            pauseDeployments: false,
            cancelOpenOrders: false
          }
        })
      );
    });

    it('returns existing state when trading is already halted', async () => {
      const state = createTradingState({
        tradingEnabled: false,
        haltedBy: 'admin-previous',
        haltedAt: new Date('2024-01-01T00:00:00.000Z')
      });
      tradingStateRepo.findOne.mockResolvedValueOnce(state);

      const dto: HaltTradingDto = { reason: 'Already halted' };
      const result = await service.haltTrading('admin-2', dto);

      expect(result).toBe(state);
      expect(tradingStateRepo.save).not.toHaveBeenCalled();
      expect(auditService.createAuditLog).not.toHaveBeenCalled();
    });
  });

  describe('resumeTrading', () => {
    it('transitions trading state and writes audit log', async () => {
      const haltedAt = new Date(Date.now() - 60_000);
      const state = createTradingState({
        tradingEnabled: false,
        haltedAt,
        haltedBy: 'admin-1',
        haltReason: 'Safety',
        metadata: { source: 'seed' }
      });
      tradingStateRepo.findOne.mockResolvedValueOnce(state);
      tradingStateRepo.save.mockImplementation(async (saved) => saved as TradingState);
      tradingStateRepo.findOne.mockResolvedValueOnce(state);

      const dto: ResumeTradingDto = {
        reason: 'Market stabilized',
        metadata: { validator: 'ops' }
      };

      const result = await service.resumeTrading('admin-2', dto);

      expect(result.tradingEnabled).toBe(true);
      expect(result.resumedAt).toEqual(expect.any(Date));
      expect(result.resumedBy).toBe('admin-2');
      expect(result.resumeReason).toBe(dto.reason);
      expect(result.metadata).toEqual(
        expect.objectContaining({
          source: 'seed',
          lastResumeMetadata: dto.metadata
        })
      );
      expect(tradingStateRepo.save).toHaveBeenCalledTimes(1);
      expect(auditService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.MANUAL_INTERVENTION,
          entityType: 'TradingState',
          userId: 'admin-2',
          metadata: expect.objectContaining({
            action: 'resume_trading',
            reason: dto.reason,
            haltDurationMs: expect.any(Number)
          })
        })
      );
    });

    it('returns existing state when trading is already enabled', async () => {
      const state = createTradingState({ tradingEnabled: true });
      tradingStateRepo.findOne.mockResolvedValueOnce(state);

      const dto: ResumeTradingDto = { reason: 'No-op' };
      const result = await service.resumeTrading('admin-2', dto);

      expect(result).toBe(state);
      expect(tradingStateRepo.save).not.toHaveBeenCalled();
      expect(auditService.createAuditLog).not.toHaveBeenCalled();
    });
  });

  describe('cancelAllOpenOrders', () => {
    it('returns early when there are no open orders', async () => {
      orderRepo.find.mockResolvedValueOnce([]);

      const result = await service.cancelAllOpenOrders('admin-1');

      expect(result).toEqual({
        totalOrders: 0,
        successfulCancellations: 0,
        failedCancellations: 0,
        errors: []
      });
      expect(orderService.cancelManualOrder).not.toHaveBeenCalled();
      expect(auditService.createAuditLog).not.toHaveBeenCalled();
    });

    it('cancels open orders and captures failures', async () => {
      const openOrders = [
        createOrder({ id: 'order-1', user: { id: 'user-1' } as any }),
        createOrder({ id: 'order-2', user: null as any }),
        createOrder({ id: 'order-3', user: { id: 'user-2' } as any })
      ];
      orderRepo.find.mockResolvedValueOnce(openOrders);
      orderService.cancelManualOrder.mockResolvedValueOnce({} as Order);
      orderService.cancelManualOrder.mockRejectedValueOnce(new Error('Exchange rejected'));

      const result = await service.cancelAllOpenOrders('admin-1');

      expect(orderRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          relations: ['user', 'exchange']
        })
      );
      expect(orderService.cancelManualOrder).toHaveBeenCalledTimes(2);
      expect(orderService.cancelManualOrder).toHaveBeenCalledWith('order-1', openOrders[0].user);
      expect(orderService.cancelManualOrder).toHaveBeenCalledWith('order-3', openOrders[2].user);
      expect(result.totalOrders).toBe(3);
      expect(result.successfulCancellations).toBe(1);
      expect(result.failedCancellations).toBe(2);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            orderId: 'order-2',
            userId: 'unknown'
          }),
          expect.objectContaining({
            orderId: 'order-3',
            userId: 'user-2',
            error: 'Exchange rejected'
          })
        ])
      );
      expect(auditService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.MANUAL_INTERVENTION,
          entityType: 'Order',
          entityId: 'bulk_cancellation',
          userId: 'admin-1',
          metadata: expect.objectContaining({
            action: 'cancel_all_orders',
            totalOrders: 3,
            successful: 1,
            failed: 2
          })
        })
      );
    });
  });
});
