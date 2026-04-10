import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { OrderController } from './order.controller';
import { type Order, OrderSide, OrderStatus, OrderType } from './order.entity';
import { OrderService } from './order.service';
import { ManualOrderService } from './services/manual-order.service';
import { OrderStateMachineService } from './services/order-state-machine.service';
import { SlippageAnalysisService } from './services/slippage-analysis.service';

import { type User } from '../users/users.entity';

describe('OrderController', () => {
  let controller: OrderController;
  let orderService: jest.Mocked<OrderService>;
  let manualOrderService: jest.Mocked<ManualOrderService>;
  let slippageAnalysisService: jest.Mocked<SlippageAnalysisService>;
  let stateMachineService: jest.Mocked<OrderStateMachineService>;

  const mockUser: User = { id: 'user-123', email: 'test@example.com' } as User;
  const mockOrder: Order = {
    id: 'order-123',
    symbol: 'BTC/USDT',
    side: OrderSide.BUY,
    type: OrderType.MARKET,
    quantity: 0.1,
    price: 50000,
    status: OrderStatus.FILLED
  } as Order;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrderController],
      providers: [
        {
          provide: OrderService,
          useValue: { getOrders: jest.fn(), getOrder: jest.fn() }
        },
        {
          provide: ManualOrderService,
          useValue: {
            placeManualOrder: jest.fn(),
            previewManualOrder: jest.fn(),
            cancelManualOrder: jest.fn()
          }
        },
        {
          provide: SlippageAnalysisService,
          useValue: {
            getSlippageSummary: jest.fn(),
            getSlippageBySymbol: jest.fn(),
            getSlippageTrends: jest.fn(),
            getHighSlippagePairs: jest.fn()
          }
        },
        {
          provide: OrderStateMachineService,
          useValue: { getOrderHistory: jest.fn() }
        }
      ]
    }).compile();

    controller = module.get<OrderController>(OrderController);
    orderService = module.get(OrderService);
    manualOrderService = module.get(ManualOrderService);
    slippageAnalysisService = module.get(SlippageAnalysisService);
    stateMachineService = module.get(OrderStateMachineService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getOrders', () => {
    it('applies default limit=50 when no filters provided', async () => {
      orderService.getOrders.mockResolvedValue([mockOrder]);

      const result = await controller.getOrders(mockUser);

      expect(orderService.getOrders).toHaveBeenCalledWith(mockUser, {
        status: undefined,
        side: undefined,
        orderType: undefined,
        isManual: undefined,
        limit: 50
      });
      expect(result).toEqual([mockOrder]);
    });

    it('forwards all filter params to the service', async () => {
      orderService.getOrders.mockResolvedValue([mockOrder]);

      await controller.getOrders(mockUser, OrderStatus.FILLED, OrderSide.BUY, OrderType.MARKET, true, 10);

      expect(orderService.getOrders).toHaveBeenCalledWith(mockUser, {
        status: OrderStatus.FILLED,
        side: OrderSide.BUY,
        orderType: OrderType.MARKET,
        isManual: true,
        limit: 10
      });
    });
  });

  describe('getOrder', () => {
    it('returns the order from the service', async () => {
      orderService.getOrder.mockResolvedValue(mockOrder);

      const result = await controller.getOrder('order-123', mockUser);

      expect(orderService.getOrder).toHaveBeenCalledWith(mockUser, 'order-123');
      expect(result).toEqual(mockOrder);
    });
  });

  describe('getOrderHistory', () => {
    it('composes order status with transition history', async () => {
      const transitions = [
        {
          id: 'h1',
          orderId: 'order-123',
          fromStatus: null,
          toStatus: OrderStatus.NEW,
          transitionedAt: new Date(),
          reason: 'trade_execution',
          metadata: {}
        },
        {
          id: 'h2',
          orderId: 'order-123',
          fromStatus: OrderStatus.NEW,
          toStatus: OrderStatus.FILLED,
          transitionedAt: new Date(),
          reason: 'exchange_sync',
          metadata: {}
        }
      ];
      orderService.getOrder.mockResolvedValue(mockOrder);
      stateMachineService.getOrderHistory.mockResolvedValue(transitions as never);

      const result = await controller.getOrderHistory('order-123', mockUser);

      expect(orderService.getOrder).toHaveBeenCalledWith(mockUser, 'order-123');
      expect(stateMachineService.getOrderHistory).toHaveBeenCalledWith('order-123');
      expect(result).toEqual({
        orderId: 'order-123',
        currentStatus: OrderStatus.FILLED,
        transitionCount: 2,
        transitions
      });
    });

    it('propagates NotFoundException when the order does not exist', async () => {
      orderService.getOrder.mockRejectedValue(new NotFoundException('Order not found'));

      await expect(controller.getOrderHistory('missing', mockUser)).rejects.toThrow(NotFoundException);
      expect(stateMachineService.getOrderHistory).not.toHaveBeenCalled();
    });
  });

  describe('placeManualOrder', () => {
    it('delegates to ManualOrderService with dto and user', async () => {
      const dto = { symbol: 'BTC/USDT' } as never;
      manualOrderService.placeManualOrder.mockResolvedValue(mockOrder as never);

      const result = await controller.placeManualOrder(dto, mockUser);

      expect(manualOrderService.placeManualOrder).toHaveBeenCalledWith(dto, mockUser);
      expect(result).toBe(mockOrder);
    });
  });

  describe('previewManualOrder', () => {
    it('delegates to ManualOrderService with dto and user', async () => {
      const dto = { symbol: 'BTC/USDT' } as never;
      const preview = { estimatedCost: 5000 } as never;
      manualOrderService.previewManualOrder.mockResolvedValue(preview);

      const result = await controller.previewManualOrder(dto, mockUser);

      expect(manualOrderService.previewManualOrder).toHaveBeenCalledWith(dto, mockUser);
      expect(result).toBe(preview);
    });
  });

  describe('cancelOrder', () => {
    it('delegates to ManualOrderService.cancelManualOrder with id and user', async () => {
      manualOrderService.cancelManualOrder.mockResolvedValue(mockOrder as never);

      const result = await controller.cancelOrder('order-123', mockUser);

      expect(manualOrderService.cancelManualOrder).toHaveBeenCalledWith('order-123', mockUser);
      expect(result).toBe(mockOrder);
    });
  });

  describe('slippage analytics', () => {
    it('getSlippageSummary passes user.id', async () => {
      const summary = { avgSlippageBps: 10 } as never;
      slippageAnalysisService.getSlippageSummary.mockResolvedValue(summary);

      const result = await controller.getSlippageSummary(mockUser);

      expect(slippageAnalysisService.getSlippageSummary).toHaveBeenCalledWith('user-123');
      expect(result).toBe(summary);
    });

    it('getSlippageBySymbol passes user.id', async () => {
      slippageAnalysisService.getSlippageBySymbol.mockResolvedValue([] as never);

      await controller.getSlippageBySymbol(mockUser);

      expect(slippageAnalysisService.getSlippageBySymbol).toHaveBeenCalledWith('user-123');
    });

    it('getSlippageTrends forwards period from query', async () => {
      slippageAnalysisService.getSlippageTrends.mockResolvedValue([] as never);

      await controller.getSlippageTrends(mockUser, { period: '7d' } as never);

      expect(slippageAnalysisService.getSlippageTrends).toHaveBeenCalledWith('user-123', '7d');
    });

    it('getHighSlippagePairs forwards thresholdBps from query', async () => {
      slippageAnalysisService.getHighSlippagePairs.mockResolvedValue(['BTC/USDT']);

      const result = await controller.getHighSlippagePairs({ thresholdBps: 75 } as never);

      expect(slippageAnalysisService.getHighSlippagePairs).toHaveBeenCalledWith(75);
      expect(result).toEqual(['BTC/USDT']);
    });
  });
});
