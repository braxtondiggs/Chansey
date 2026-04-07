import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { OrderHoldingsService } from './order-holdings.service';

import { User } from '../../users/users.entity';
import { Order, OrderSide, OrderStatus, OrderType } from '../order.entity';

describe('OrderHoldingsService', () => {
  let service: OrderHoldingsService;
  let orderRepository: jest.Mocked<Repository<Order>>;

  const mockUser: User = { id: 'user-123', email: 't@e.com' } as User;

  const mockBtcCoin = {
    id: 'coin-btc',
    symbol: 'BTC',
    name: 'Bitcoin',
    slug: 'bitcoin',
    currentPrice: 43250.5
  };

  const mockBinanceExchange = { id: 'exchange-binance', name: 'Binance', slug: 'binance_us' };
  const mockCoinbaseExchange = { id: 'exchange-coinbase', name: 'Coinbase', slug: 'coinbase_pro' };

  const mockOrder: Order = {
    id: 'order-123',
    symbol: 'BTC/USDT',
    side: OrderSide.BUY,
    type: OrderType.MARKET,
    quantity: 0.1,
    price: 50000,
    executedQuantity: 0.1,
    cost: 5000,
    status: OrderStatus.FILLED,
    transactTime: new Date(),
    user: mockUser,
    createdAt: new Date(),
    updatedAt: new Date()
  } as Order;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderHoldingsService,
        {
          provide: getRepositoryToken(Order),
          useValue: { find: jest.fn() }
        }
      ]
    }).compile();

    service = module.get<OrderHoldingsService>(OrderHoldingsService);
    orderRepository = module.get(getRepositoryToken(Order));
  });

  afterEach(() => jest.clearAllMocks());

  it('aggregates buy orders across multiple exchanges', async () => {
    const buyOrders = [
      {
        ...mockOrder,
        baseCoin: mockBtcCoin,
        exchange: mockBinanceExchange,
        side: OrderSide.BUY,
        executedQuantity: 0.3,
        price: 40000,
        cost: 12000
      } as Order,
      {
        ...mockOrder,
        baseCoin: mockBtcCoin,
        exchange: mockCoinbaseExchange,
        side: OrderSide.BUY,
        executedQuantity: 0.2,
        price: 45000,
        cost: 9000
      } as Order
    ];

    orderRepository.find.mockResolvedValue(buyOrders);

    const result = await service.getHoldingsByCoin(mockUser, mockBtcCoin as any);

    expect(result.coinSymbol).toBe('BTC');
    expect(result.totalAmount).toBe(0.5);
    expect(result.averageBuyPrice).toBe(42000);
    expect(result.currentValue).toBe(21625.25);
    expect(result.exchanges).toHaveLength(2);
  });

  it('calculates weighted average buy price correctly', async () => {
    const orders = [
      {
        ...mockOrder,
        baseCoin: mockBtcCoin,
        exchange: mockBinanceExchange,
        side: OrderSide.BUY,
        executedQuantity: 0.5,
        price: 40000,
        cost: 20000
      } as Order,
      {
        ...mockOrder,
        baseCoin: mockBtcCoin,
        exchange: mockBinanceExchange,
        side: OrderSide.BUY,
        executedQuantity: 0.3,
        price: 50000,
        cost: 15000
      } as Order,
      {
        ...mockOrder,
        baseCoin: mockBtcCoin,
        exchange: mockBinanceExchange,
        side: OrderSide.BUY,
        executedQuantity: 0.2,
        price: 45000,
        cost: 9000
      } as Order
    ];
    orderRepository.find.mockResolvedValue(orders);

    const result = await service.getHoldingsByCoin(mockUser, mockBtcCoin as any);

    expect(result.averageBuyPrice).toBe(44000);
    expect(result.totalAmount).toBe(1.0);
  });

  it('handles sells reducing total amount', async () => {
    const orders = [
      {
        ...mockOrder,
        baseCoin: mockBtcCoin,
        exchange: mockBinanceExchange,
        side: OrderSide.BUY,
        executedQuantity: 1.0,
        price: 40000,
        cost: 40000
      } as Order,
      {
        ...mockOrder,
        baseCoin: mockBtcCoin,
        exchange: mockBinanceExchange,
        side: OrderSide.SELL,
        executedQuantity: 0.3,
        price: 45000,
        cost: 13500
      } as Order
    ];
    orderRepository.find.mockResolvedValue(orders);

    const result = await service.getHoldingsByCoin(mockUser, mockBtcCoin as any);

    expect(result.totalAmount).toBe(0.7);
    expect(result.averageBuyPrice).toBe(40000);
  });

  it('handles no orders (zero holdings)', async () => {
    orderRepository.find.mockResolvedValue([]);

    const result = await service.getHoldingsByCoin(mockUser, mockBtcCoin as any);

    expect(result.totalAmount).toBe(0);
    expect(result.averageBuyPrice).toBe(0);
    expect(result.currentValue).toBe(0);
    expect(result.profitLoss).toBe(0);
    expect(result.profitLossPercent).toBe(0);
    expect(result.exchanges).toHaveLength(0);
  });

  it('calculates profit/loss correctly', async () => {
    const orders = [
      {
        ...mockOrder,
        baseCoin: mockBtcCoin,
        exchange: mockBinanceExchange,
        side: OrderSide.BUY,
        executedQuantity: 0.5,
        price: 38000,
        cost: 19000
      } as Order
    ];
    orderRepository.find.mockResolvedValue(orders);

    const result = await service.getHoldingsByCoin(mockUser, mockBtcCoin as any);

    expect(result.currentValue).toBeCloseTo(21625.25, 2);
    expect(result.profitLoss).toBeCloseTo(2625.25, 2);
    expect(result.profitLossPercent).toBeCloseTo(13.82, 2);
  });

  it('provides per-exchange breakdown', async () => {
    const orders = [
      {
        ...mockOrder,
        baseCoin: mockBtcCoin,
        exchange: mockBinanceExchange,
        side: OrderSide.BUY,
        executedQuantity: 0.3,
        price: 40000,
        cost: 12000,
        transactTime: new Date('2024-01-01')
      } as Order,
      {
        ...mockOrder,
        baseCoin: mockBtcCoin,
        exchange: mockCoinbaseExchange,
        side: OrderSide.BUY,
        executedQuantity: 0.2,
        price: 45000,
        cost: 9000,
        transactTime: new Date('2024-01-02')
      } as Order
    ];
    orderRepository.find.mockResolvedValue(orders);

    const result = await service.getHoldingsByCoin(mockUser, mockBtcCoin as any);

    expect(result.exchanges).toHaveLength(2);
    const binance = result.exchanges.find((e: any) => e.exchangeName === 'Binance')!;
    expect(binance.amount).toBe(0.3);
    expect(binance.lastSynced).toEqual(new Date('2024-01-01'));
    const coinbase = result.exchanges.find((e: any) => e.exchangeName === 'Coinbase')!;
    expect(coinbase.amount).toBe(0.2);
  });

  it('falls back to amount * price when cost is missing', async () => {
    const orders = [
      {
        ...mockOrder,
        baseCoin: mockBtcCoin,
        exchange: mockBinanceExchange,
        side: OrderSide.BUY,
        executedQuantity: 0.5,
        price: 40000,
        cost: 0
      } as Order
    ];
    orderRepository.find.mockResolvedValue(orders);

    const result = await service.getHoldingsByCoin(mockUser, mockBtcCoin as any);

    expect(result.averageBuyPrice).toBe(40000);
  });

  it('labels orders without an exchange as Unknown', async () => {
    const orders = [
      {
        ...mockOrder,
        baseCoin: mockBtcCoin,
        exchange: undefined,
        side: OrderSide.BUY,
        executedQuantity: 0.1,
        price: 40000,
        cost: 4000
      } as unknown as Order
    ];
    orderRepository.find.mockResolvedValue(orders);

    const result = await service.getHoldingsByCoin(mockUser, mockBtcCoin as any);

    expect(result.exchanges).toHaveLength(1);
    expect(result.exchanges[0].exchangeName).toBe('Unknown');
  });

  it('returns zero currentValue when coin has no current price', async () => {
    orderRepository.find.mockResolvedValue([
      {
        ...mockOrder,
        baseCoin: mockBtcCoin,
        exchange: mockBinanceExchange,
        side: OrderSide.BUY,
        executedQuantity: 0.5,
        price: 40000,
        cost: 20000
      } as Order
    ]);

    const result = await service.getHoldingsByCoin(mockUser, { ...mockBtcCoin, currentPrice: undefined } as any);

    expect(result.currentValue).toBe(0);
    expect(result.profitLoss).toBe(-20000);
  });

  it('keeps totals consistent when selling on an exchange without prior buys', async () => {
    // Buy 1.0 on Binance, sell 0.3 on Coinbase → net 0.7, but per-exchange shows
    // Binance=+1.0 and Coinbase=-0.3 internally. Final filter removes the negative exchange,
    // but totalBought/totalSold/totalAmount must still be correct.
    const orders = [
      {
        ...mockOrder,
        baseCoin: mockBtcCoin,
        exchange: mockBinanceExchange,
        side: OrderSide.BUY,
        executedQuantity: 1.0,
        price: 40000,
        cost: 40000
      } as Order,
      {
        ...mockOrder,
        baseCoin: mockBtcCoin,
        exchange: mockCoinbaseExchange,
        side: OrderSide.SELL,
        executedQuantity: 0.3,
        price: 45000,
        cost: 13500
      } as Order
    ];
    orderRepository.find.mockResolvedValue(orders);

    const result = await service.getHoldingsByCoin(mockUser, mockBtcCoin as any);

    expect(result.totalAmount).toBeCloseTo(0.7, 10);
    // Only Binance (positive) remains after amount > 0 filter
    expect(result.exchanges).toHaveLength(1);
    expect(result.exchanges[0].exchangeName).toBe('Binance');
  });

  it('excludes exchanges with zero holdings', async () => {
    const orders = [
      {
        ...mockOrder,
        baseCoin: mockBtcCoin,
        exchange: mockBinanceExchange,
        side: OrderSide.BUY,
        executedQuantity: 0.5,
        price: 40000,
        cost: 20000
      } as Order,
      {
        ...mockOrder,
        baseCoin: mockBtcCoin,
        exchange: mockBinanceExchange,
        side: OrderSide.SELL,
        executedQuantity: 0.5,
        price: 45000,
        cost: 22500
      } as Order,
      {
        ...mockOrder,
        baseCoin: mockBtcCoin,
        exchange: mockCoinbaseExchange,
        side: OrderSide.BUY,
        executedQuantity: 0.2,
        price: 43000,
        cost: 8600
      } as Order
    ];
    orderRepository.find.mockResolvedValue(orders);

    const result = await service.getHoldingsByCoin(mockUser, mockBtcCoin as any);

    expect(result.totalAmount).toBeCloseTo(0.2, 10);
    expect(result.exchanges).toHaveLength(1);
    expect(result.exchanges[0].exchangeName).toBe('Coinbase');
  });
});
