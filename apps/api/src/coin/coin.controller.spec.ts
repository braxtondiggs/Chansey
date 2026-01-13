import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { CoinsController } from './coin.controller';
import { CoinService } from './coin.service';

import { OrderService } from '../order/order.service';

describe('CoinsController', () => {
  let controller: CoinsController;
  let coinService: jest.Mocked<CoinService>;
  let orderService: jest.Mocked<OrderService>;

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com'
  };

  const mockCoin = {
    id: 'coin-uuid-123',
    slug: 'bitcoin'
  };

  const mockCoinDetail = {
    id: 'coin-uuid-123',
    slug: 'bitcoin',
    name: 'Bitcoin',
    symbol: 'BTC',
    currentPrice: 43250.5,
    marketCapRank: 1
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CoinsController],
      providers: [
        {
          provide: CoinService,
          useValue: {
            getCoinDetailBySlug: jest.fn(),
            getMarketChart: jest.fn(),
            getCoinBySlug: jest.fn()
          }
        },
        {
          provide: OrderService,
          useValue: {
            getHoldingsByCoin: jest.fn()
          }
        }
      ]
    }).compile();

    controller = module.get<CoinsController>(CoinsController);
    coinService = module.get(CoinService) as jest.Mocked<CoinService>;
    orderService = module.get(OrderService) as jest.Mocked<OrderService>;
  });

  describe('getCoinDetail', () => {
    it('returns coin detail for unauthenticated requests', async () => {
      coinService.getCoinDetailBySlug.mockResolvedValue(mockCoinDetail as any);

      const result = await controller.getCoinDetail('bitcoin', { user: undefined });

      expect(result).toEqual(mockCoinDetail);
      expect(coinService.getCoinDetailBySlug).toHaveBeenCalledWith('bitcoin');
      expect(coinService.getCoinBySlug).not.toHaveBeenCalled();
      expect(orderService.getHoldingsByCoin).not.toHaveBeenCalled();
    });

    it('adds userHoldings when authenticated user has holdings', async () => {
      const mockHoldings = {
        coinSymbol: 'BTC',
        totalAmount: 0.5,
        averageBuyPrice: 38000
      };

      coinService.getCoinDetailBySlug.mockResolvedValue({ ...mockCoinDetail } as any);
      coinService.getCoinBySlug.mockResolvedValue(mockCoin as any);
      orderService.getHoldingsByCoin.mockResolvedValue(mockHoldings as any);

      const result = await controller.getCoinDetail('bitcoin', { user: mockUser });

      expect(result).toMatchObject({
        ...mockCoinDetail,
        userHoldings: mockHoldings
      });
      expect(coinService.getCoinBySlug).toHaveBeenCalledWith('bitcoin');
      expect(orderService.getHoldingsByCoin).toHaveBeenCalledWith(mockUser, mockCoin);
    });

    it('does not add userHoldings when totalAmount is zero', async () => {
      const mockHoldings = {
        coinSymbol: 'BTC',
        totalAmount: 0
      };

      coinService.getCoinDetailBySlug.mockResolvedValue({ ...mockCoinDetail } as any);
      coinService.getCoinBySlug.mockResolvedValue(mockCoin as any);
      orderService.getHoldingsByCoin.mockResolvedValue(mockHoldings as any);

      const result = await controller.getCoinDetail('bitcoin', { user: mockUser });

      expect(result).toEqual(mockCoinDetail);
      expect(orderService.getHoldingsByCoin).toHaveBeenCalledWith(mockUser, mockCoin);
    });

    it('returns base detail when holdings lookup fails', async () => {
      coinService.getCoinDetailBySlug.mockResolvedValue({ ...mockCoinDetail } as any);
      coinService.getCoinBySlug.mockResolvedValue(mockCoin as any);
      orderService.getHoldingsByCoin.mockRejectedValue(new Error('boom'));

      const result = await controller.getCoinDetail('bitcoin', { user: mockUser });

      expect(result).toEqual(mockCoinDetail);
      expect(orderService.getHoldingsByCoin).toHaveBeenCalledWith(mockUser, mockCoin);
    });
  });

  describe('getMarketChart', () => {
    it('returns chart data for a valid period', async () => {
      const mockChart = {
        coinSlug: 'bitcoin',
        period: '7d',
        prices: [{ timestamp: 1697846400000, price: 42000.5 }],
        timestamps: [1697846400000]
      };

      coinService.getMarketChart.mockResolvedValue(mockChart as any);

      const result = await controller.getMarketChart('bitcoin', '7d');

      expect(result).toEqual(mockChart);
      expect(coinService.getMarketChart).toHaveBeenCalledWith('bitcoin', '7d');
    });

    it('throws BadRequestException for invalid period', async () => {
      await expect(controller.getMarketChart('bitcoin', 'invalid' as any)).rejects.toBeInstanceOf(BadRequestException);
      expect(coinService.getMarketChart).not.toHaveBeenCalled();
    });
  });

  describe('getHoldings', () => {
    it('returns holdings when coin exists', async () => {
      const mockHoldings = {
        coinSymbol: 'BTC',
        totalAmount: 0.5
      };

      coinService.getCoinBySlug.mockResolvedValue(mockCoin as any);
      orderService.getHoldingsByCoin.mockResolvedValue(mockHoldings as any);

      const result = await controller.getHoldings('bitcoin', mockUser as any);

      expect(result).toEqual(mockHoldings);
      expect(coinService.getCoinBySlug).toHaveBeenCalledWith('bitcoin');
      expect(orderService.getHoldingsByCoin).toHaveBeenCalledWith(mockUser, mockCoin);
    });

    it('throws when coin does not exist', async () => {
      coinService.getCoinBySlug.mockResolvedValue(null);

      await expect(controller.getHoldings('bitcoin', mockUser as any)).rejects.toThrow(
        "Coin with slug 'bitcoin' not found"
      );
      expect(orderService.getHoldingsByCoin).not.toHaveBeenCalled();
    });
  });
});
