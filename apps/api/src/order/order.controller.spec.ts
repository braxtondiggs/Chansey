import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { OrderDto } from './dto/order.dto';
import { OrderController } from './order.controller';
import { Order, OrderSide, OrderStatus, OrderType } from './order.entity';
import { OrderService } from './order.service';

import { User } from '../users/users.entity';

describe('OrderController', () => {
  let controller: OrderController;
  let orderService: jest.Mocked<OrderService>;

  const mockUser: User = {
    id: 'user-123',
    email: 'test@example.com'
  } as User;

  const mockOrder: Order = {
    id: 'order-123',
    symbol: 'BTC/USDT',
    side: OrderSide.BUY,
    type: OrderType.MARKET,
    quantity: 0.1,
    price: 50000,
    status: OrderStatus.FILLED,
    createdAt: new Date(),
    updatedAt: new Date()
  } as Order;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrderController],
      providers: [
        {
          provide: OrderService,
          useValue: {
            createOrder: jest.fn(),
            getOrders: jest.fn(),
            getOrder: jest.fn()
          }
        }
      ]
    }).compile();

    controller = module.get<OrderController>(OrderController);
    orderService = module.get(OrderService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createOrder', () => {
    const mockOrderDto: OrderDto = {
      side: OrderSide.BUY,
      type: OrderType.MARKET,
      coinId: 'coin-btc',
      quantity: '0.1'
    };

    it('should create an order successfully', async () => {
      orderService.createOrder.mockResolvedValue(mockOrder);

      const result = await controller.createOrder(mockOrderDto, mockUser);

      expect(orderService.createOrder).toHaveBeenCalledWith(mockOrderDto, mockUser);
      expect(result).toEqual(mockOrder);
    });

    it('should throw BadRequestException when service throws error', async () => {
      orderService.createOrder.mockRejectedValue(new BadRequestException('Invalid order'));

      await expect(controller.createOrder(mockOrderDto, mockUser)).rejects.toThrow(BadRequestException);
    });
  });

  describe('getOrders', () => {
    it('should return orders with no filters', async () => {
      const mockOrders = [mockOrder];
      orderService.getOrders.mockResolvedValue(mockOrders);

      const result = await controller.getOrders(mockUser);

      expect(orderService.getOrders).toHaveBeenCalledWith(mockUser, {
        status: undefined,
        side: undefined,
        limit: 50
      });
      expect(result).toEqual(mockOrders);
    });

    it('should return orders with status filter', async () => {
      const mockOrders = [mockOrder];
      orderService.getOrders.mockResolvedValue(mockOrders);

      const result = await controller.getOrders(mockUser, OrderStatus.FILLED);

      expect(orderService.getOrders).toHaveBeenCalledWith(mockUser, {
        status: OrderStatus.FILLED,
        side: undefined,
        limit: 50
      });
      expect(result).toEqual(mockOrders);
    });

    it('should return orders with side filter', async () => {
      const mockOrders = [mockOrder];
      orderService.getOrders.mockResolvedValue(mockOrders);

      const result = await controller.getOrders(mockUser, undefined, OrderSide.BUY);

      expect(orderService.getOrders).toHaveBeenCalledWith(mockUser, {
        status: undefined,
        side: OrderSide.BUY,
        limit: 50
      });
      expect(result).toEqual(mockOrders);
    });

    it('should return orders with custom limit', async () => {
      const mockOrders = [mockOrder];
      orderService.getOrders.mockResolvedValue(mockOrders);

      const result = await controller.getOrders(mockUser, undefined, undefined, 25);

      expect(orderService.getOrders).toHaveBeenCalledWith(mockUser, {
        status: undefined,
        side: undefined,
        limit: 25
      });
      expect(result).toEqual(mockOrders);
    });

    it('should return orders with all filters', async () => {
      const mockOrders = [mockOrder];
      orderService.getOrders.mockResolvedValue(mockOrders);

      const result = await controller.getOrders(mockUser, OrderStatus.FILLED, OrderSide.BUY, 10);

      expect(orderService.getOrders).toHaveBeenCalledWith(mockUser, {
        status: OrderStatus.FILLED,
        side: OrderSide.BUY,
        limit: 10
      });
      expect(result).toEqual(mockOrders);
    });
  });

  describe('getOrder', () => {
    it('should return a specific order', async () => {
      orderService.getOrder.mockResolvedValue(mockOrder);

      const result = await controller.getOrder('order-123', mockUser);

      expect(orderService.getOrder).toHaveBeenCalledWith(mockUser, 'order-123');
      expect(result).toEqual(mockOrder);
    });

    it('should throw NotFoundException when order not found', async () => {
      orderService.getOrder.mockRejectedValue(new NotFoundException('Order not found'));

      await expect(controller.getOrder('non-existent', mockUser)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for invalid UUID', async () => {
      // This would be caught by the ParseUUIDPipe in real usage
      // but we can test the service call
      orderService.getOrder.mockRejectedValue(new BadRequestException('Invalid UUID'));

      await expect(controller.getOrder('invalid-uuid', mockUser)).rejects.toThrow(BadRequestException);
    });
  });
});
