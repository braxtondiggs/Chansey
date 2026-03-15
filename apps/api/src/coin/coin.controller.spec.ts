import { BadRequestException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';

import { CoinsController } from './coin.controller';
import { CoinService } from './coin.service';

import { BalanceService } from '../balance/balance.service';
import { OrderService } from '../order/order.service';

describe('CoinsController', () => {
  let controller: CoinsController;
  let coinService: jest.Mocked<CoinService>;
  let orderService: jest.Mocked<OrderService>;
  let balanceService: jest.Mocked<BalanceService>;

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com'
  } as any;

  const mockCoin = {
    id: 'coin-uuid-123',
    slug: 'bitcoin',
    symbol: 'BTC',
    currentPrice: 43250.5
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
            getCoinDetailWithEntity: jest.fn(),
            getMarketChart: jest.fn(),
            getCoinBySlug: jest.fn()
          }
        },
        {
          provide: OrderService,
          useValue: {
            getHoldingsByCoin: jest.fn()
          }
        },
        {
          provide: BalanceService,
          useValue: {
            getHoldingsForCoin: jest.fn()
          }
        }
      ]
    }).compile();
    await module.init();

    controller = module.get<CoinsController>(CoinsController);
    coinService = module.get(CoinService) as jest.Mocked<CoinService>;
    orderService = module.get(OrderService) as jest.Mocked<OrderService>;
    balanceService = module.get(BalanceService) as jest.Mocked<BalanceService>;
  });

  describe('getCoinDetail', () => {
    it('returns coin detail for unauthenticated requests', async () => {
      coinService.getCoinDetailWithEntity.mockResolvedValue({ dto: mockCoinDetail, entity: mockCoin } as any);

      const result = await controller.getCoinDetail('bitcoin', null);

      expect(result).toEqual(mockCoinDetail);
      expect(coinService.getCoinDetailWithEntity).toHaveBeenCalledWith('bitcoin');
    });

    it('adds userHoldings when authenticated user has balance holdings', async () => {
      const mockBalanceHoldings = {
        coinSymbol: 'BTC',
        totalAmount: 0.5,
        averageBuyPrice: 0,
        currentValue: 21625.25,
        profitLoss: 0,
        profitLossPercent: 0,
        exchanges: [{ exchangeName: 'Binance', amount: 0.5, lastSynced: new Date() }]
      };
      const mockOrderHoldings = {
        coinSymbol: 'BTC',
        totalAmount: 0.5,
        averageBuyPrice: 38000,
        currentValue: 21625.25,
        profitLoss: 2625.25,
        profitLossPercent: 13.82,
        exchanges: []
      };

      coinService.getCoinDetailWithEntity.mockResolvedValue({ dto: { ...mockCoinDetail }, entity: mockCoin } as any);
      balanceService.getHoldingsForCoin.mockResolvedValue(mockBalanceHoldings as any);
      orderService.getHoldingsByCoin.mockResolvedValue(mockOrderHoldings as any);

      const result = await controller.getCoinDetail('bitcoin', mockUser);

      expect(result.userHoldings).toBeDefined();
      expect(result.userHoldings!.totalAmount).toBe(0.5);
      expect(result.userHoldings!.averageBuyPrice).toBe(38000);
      expect(result.userHoldings!.profitLoss).toBe(21625.25 - 0.5 * 38000);
      expect(result.userHoldings!.profitLossPercent).toBeCloseTo(13.817, 2);
      expect(balanceService.getHoldingsForCoin).toHaveBeenCalledWith(mockUser, mockCoin);
    });

    it('does not add userHoldings when balance returns null', async () => {
      coinService.getCoinDetailWithEntity.mockResolvedValue({ dto: { ...mockCoinDetail }, entity: mockCoin } as any);
      balanceService.getHoldingsForCoin.mockResolvedValue(null);

      const result = await controller.getCoinDetail('bitcoin', mockUser);

      expect(result.userHoldings).toBeUndefined();
    });

    it('returns base detail when holdings lookup fails', async () => {
      coinService.getCoinDetailWithEntity.mockResolvedValue({ dto: { ...mockCoinDetail }, entity: mockCoin } as any);
      balanceService.getHoldingsForCoin.mockRejectedValue(new Error('boom'));

      const result = await controller.getCoinDetail('bitcoin', mockUser);

      expect(result).toEqual(mockCoinDetail);
    });

    it('returns holdings with zero P&L when no order data', async () => {
      const mockBalanceHoldings = {
        coinSymbol: 'XRP',
        totalAmount: 1000,
        averageBuyPrice: 0,
        currentValue: 500,
        profitLoss: 0,
        profitLossPercent: 0,
        exchanges: []
      };

      coinService.getCoinDetailWithEntity.mockResolvedValue({ dto: { ...mockCoinDetail }, entity: mockCoin } as any);
      balanceService.getHoldingsForCoin.mockResolvedValue(mockBalanceHoldings as any);
      orderService.getHoldingsByCoin.mockRejectedValue(new Error('no orders'));

      const result = await controller.getCoinDetail('bitcoin', mockUser);

      expect(result.userHoldings).toBeDefined();
      expect(result.userHoldings!.totalAmount).toBe(1000);
      expect(result.userHoldings!.averageBuyPrice).toBe(0);
      expect(result.userHoldings!.currentValue).toBe(500);
      expect(result.userHoldings!.profitLoss).toBe(0);
      expect(result.userHoldings!.profitLossPercent).toBe(0);
    });

    it('does not override P&L when order averageBuyPrice is zero', async () => {
      const mockBalanceHoldings = {
        coinSymbol: 'BTC',
        totalAmount: 0.5,
        averageBuyPrice: 0,
        currentValue: 21625.25,
        profitLoss: 0,
        profitLossPercent: 0,
        exchanges: []
      };
      const mockOrderHoldings = {
        coinSymbol: 'BTC',
        totalAmount: 0.5,
        averageBuyPrice: 0,
        currentValue: 0,
        profitLoss: 0,
        profitLossPercent: 0,
        exchanges: []
      };

      coinService.getCoinDetailWithEntity.mockResolvedValue({ dto: { ...mockCoinDetail }, entity: mockCoin } as any);
      balanceService.getHoldingsForCoin.mockResolvedValue(mockBalanceHoldings as any);
      orderService.getHoldingsByCoin.mockResolvedValue(mockOrderHoldings as any);

      const result = await controller.getCoinDetail('bitcoin', mockUser);

      expect(result.userHoldings).toBeDefined();
      expect(result.userHoldings!.averageBuyPrice).toBe(0);
      expect(result.userHoldings!.profitLoss).toBe(0);
      expect(result.userHoldings!.profitLossPercent).toBe(0);
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
    it('returns balance-based holdings enriched with order cost basis', async () => {
      const mockBalanceHoldings = {
        coinSymbol: 'BTC',
        totalAmount: 0.5,
        averageBuyPrice: 0,
        currentValue: 21625.25,
        profitLoss: 0,
        profitLossPercent: 0,
        exchanges: []
      };
      const mockOrderHoldings = {
        averageBuyPrice: 38000
      };

      coinService.getCoinBySlug.mockResolvedValue(mockCoin as any);
      balanceService.getHoldingsForCoin.mockResolvedValue(mockBalanceHoldings as any);
      orderService.getHoldingsByCoin.mockResolvedValue(mockOrderHoldings as any);

      const result = await controller.getHoldings('bitcoin', mockUser as any);

      expect(result.totalAmount).toBe(0.5);
      expect(result.averageBuyPrice).toBe(38000);
      expect(result.profitLoss).toBe(21625.25 - 0.5 * 38000);
    });

    it('returns zero holdings when no balance exists', async () => {
      coinService.getCoinBySlug.mockResolvedValue(mockCoin as any);
      balanceService.getHoldingsForCoin.mockResolvedValue(null);

      const result = await controller.getHoldings('bitcoin', mockUser as any);

      expect(result.totalAmount).toBe(0);
      expect(result.coinSymbol).toBe('BTC');
    });

    it('throws when coin does not exist', async () => {
      coinService.getCoinBySlug.mockResolvedValue(null);

      await expect(controller.getHoldings('bitcoin', mockUser as any)).rejects.toThrow(
        "Coin with slug 'bitcoin' not found"
      );
    });
  });
});
