/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { CoinMarketDataService } from './coin-market-data.service';
import { CoinsController } from './coin.controller';
import { CoinService } from './coin.service';

import { BalanceService } from '../balance/balance.service';
import { OrderService } from '../order/order.service';
import { RiskService } from '../risk/risk.service';

describe('CoinsController', () => {
  let controller: CoinsController;
  let coinService: jest.Mocked<CoinService>;
  let coinMarketDataService: jest.Mocked<CoinMarketDataService>;
  let orderService: jest.Mocked<OrderService>;
  let balanceService: jest.Mocked<BalanceService>;
  let riskService: jest.Mocked<RiskService>;

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
            getCoinBySlug: jest.fn(),
            getCoinsByRiskLevelValue: jest.fn()
          }
        },
        {
          provide: CoinMarketDataService,
          useValue: {
            getCoinDetailBySlug: jest.fn(),
            getCoinDetailWithEntity: jest.fn(),
            getMarketChart: jest.fn()
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
        },
        {
          provide: RiskService,
          useValue: {
            findByLevel: jest.fn()
          }
        }
      ]
    }).compile();
    await module.init();

    controller = module.get<CoinsController>(CoinsController);
    coinService = module.get(CoinService) as jest.Mocked<CoinService>;
    coinMarketDataService = module.get(CoinMarketDataService) as jest.Mocked<CoinMarketDataService>;
    orderService = module.get(OrderService) as jest.Mocked<OrderService>;
    balanceService = module.get(BalanceService) as jest.Mocked<BalanceService>;
    riskService = module.get(RiskService) as jest.Mocked<RiskService>;
  });

  describe('getCoinDetail', () => {
    it('returns coin detail for unauthenticated requests', async () => {
      coinMarketDataService.getCoinDetailWithEntity.mockResolvedValue({ dto: mockCoinDetail, entity: mockCoin } as any);

      const result = await controller.getCoinDetail('bitcoin', null);

      expect(result).toEqual(mockCoinDetail);
      expect(coinMarketDataService.getCoinDetailWithEntity).toHaveBeenCalledWith('bitcoin');
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

      coinMarketDataService.getCoinDetailWithEntity.mockResolvedValue({
        dto: { ...mockCoinDetail },
        entity: mockCoin
      } as any);
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
      coinMarketDataService.getCoinDetailWithEntity.mockResolvedValue({
        dto: { ...mockCoinDetail },
        entity: mockCoin
      } as any);
      balanceService.getHoldingsForCoin.mockResolvedValue(null);

      const result = await controller.getCoinDetail('bitcoin', mockUser);

      expect(result.userHoldings).toBeUndefined();
    });

    it('returns base detail when holdings lookup fails', async () => {
      coinMarketDataService.getCoinDetailWithEntity.mockResolvedValue({
        dto: { ...mockCoinDetail },
        entity: mockCoin
      } as any);
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

      coinMarketDataService.getCoinDetailWithEntity.mockResolvedValue({
        dto: { ...mockCoinDetail },
        entity: mockCoin
      } as any);
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

      coinMarketDataService.getCoinDetailWithEntity.mockResolvedValue({
        dto: { ...mockCoinDetail },
        entity: mockCoin
      } as any);
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

      coinMarketDataService.getMarketChart.mockResolvedValue(mockChart as any);

      const result = await controller.getMarketChart('bitcoin', '7d');

      expect(result).toEqual(mockChart);
      expect(coinMarketDataService.getMarketChart).toHaveBeenCalledWith('bitcoin', '7d');
    });

    it('throws BadRequestException for invalid period', async () => {
      await expect(controller.getMarketChart('bitcoin', 'invalid' as any)).rejects.toBeInstanceOf(BadRequestException);
      expect(coinMarketDataService.getMarketChart).not.toHaveBeenCalled();
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

    it('returns zero holdings when BalanceService is not resolved', async () => {
      (controller as any).balanceService = null;
      coinService.getCoinBySlug.mockResolvedValue(mockCoin as any);

      const result = await controller.getHoldings('bitcoin', mockUser as any);

      expect(result.totalAmount).toBe(0);
      expect(result.coinSymbol).toBe('BTC');
    });
  });

  describe('getPreviewCoins', () => {
    it('returns coins for a valid risk level', async () => {
      const mockCoins = [mockCoin] as any;
      riskService.findByLevel.mockResolvedValue({ coinCount: 12 } as any);
      coinService.getCoinsByRiskLevelValue.mockResolvedValue(mockCoins);

      const result = await controller.getPreviewCoins('3');

      expect(result).toEqual(mockCoins);
      expect(riskService.findByLevel).toHaveBeenCalledWith(3);
      expect(coinService.getCoinsByRiskLevelValue).toHaveBeenCalledWith(3, 12);
    });

    it('throws BadRequestException for non-numeric risk level', async () => {
      await expect(controller.getPreviewCoins('abc')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException for out-of-range risk level', async () => {
      await expect(controller.getPreviewCoins('0')).rejects.toBeInstanceOf(BadRequestException);
      await expect(controller.getPreviewCoins('6')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('uses limit parameter when provided', async () => {
      riskService.findByLevel.mockResolvedValue({ coinCount: 12 } as any);
      coinService.getCoinsByRiskLevelValue.mockResolvedValue([]);

      await controller.getPreviewCoins('3', '20');

      expect(coinService.getCoinsByRiskLevelValue).toHaveBeenCalledWith(3, 20);
    });

    it('falls back to default coin count when risk entity not found', async () => {
      riskService.findByLevel.mockResolvedValue(null);
      coinService.getCoinsByRiskLevelValue.mockResolvedValue([]);

      await controller.getPreviewCoins('1');

      expect(coinService.getCoinsByRiskLevelValue).toHaveBeenCalledWith(1, expect.any(Number));
    });

    it('uses coinCount when limit is not a valid number', async () => {
      riskService.findByLevel.mockResolvedValue({ coinCount: 12 } as any);
      coinService.getCoinsByRiskLevelValue.mockResolvedValue([]);

      await controller.getPreviewCoins('3', 'abc');

      expect(coinService.getCoinsByRiskLevelValue).toHaveBeenCalledWith(3, 12);
    });
  });

  describe('getCoinDetail (balanceService unavailable)', () => {
    it('returns detail without holdings when BalanceService is not resolved', async () => {
      (controller as any).balanceService = null;
      coinMarketDataService.getCoinDetailWithEntity.mockResolvedValue({
        dto: { ...mockCoinDetail },
        entity: mockCoin
      } as any);

      const result = await controller.getCoinDetail('bitcoin', mockUser);

      expect(result).toEqual(mockCoinDetail);
      expect(result.userHoldings).toBeUndefined();
    });
  });
});
