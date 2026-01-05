import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { SlippageAnalysisService } from './slippage-analysis.service';

import { Order, OrderStatus } from '../order.entity';

describe('SlippageAnalysisService', () => {
  let service: SlippageAnalysisService;
  let mockOrderRepository: any;
  let mockQueryBuilder: any;

  const mockUserId = 'test-user-id';
  const mockSymbol = 'BTC/USDT';

  beforeEach(async () => {
    // Create mock query builder
    mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      having: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawOne: jest.fn(),
      getRawMany: jest.fn()
    };

    mockOrderRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlippageAnalysisService,
        {
          provide: getRepositoryToken(Order),
          useValue: mockOrderRepository
        }
      ]
    }).compile();

    service = module.get<SlippageAnalysisService>(SlippageAnalysisService);
  });

  describe('getSlippageSummary', () => {
    it('should return summary statistics for user', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue({
        totalOrders: '100',
        avgSlippageBps: '15.5',
        maxSlippageBps: '120.25',
        highSlippageOrderCount: '5',
        totalSlippageCostUsd: '250.75'
      });

      const result = await service.getSlippageSummary(mockUserId);

      expect(result).toEqual({
        totalOrders: 100,
        avgSlippageBps: 15.5,
        maxSlippageBps: 120.25,
        totalSlippageCostUsd: 250.75,
        highSlippageOrderCount: 5
      });

      expect(mockQueryBuilder.where).toHaveBeenCalledWith('order.userId = :userId', { userId: mockUserId });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('order.actualSlippageBps IS NOT NULL');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('order.status = :status', { status: OrderStatus.FILLED });
    });

    it('should return zero values when no data', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue(null);

      const result = await service.getSlippageSummary(mockUserId);

      expect(result).toEqual({
        totalOrders: 0,
        avgSlippageBps: 0,
        maxSlippageBps: 0,
        totalSlippageCostUsd: 0,
        highSlippageOrderCount: 0
      });
    });

    it('should handle undefined values gracefully', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue({
        totalOrders: undefined,
        avgSlippageBps: undefined,
        maxSlippageBps: undefined,
        highSlippageOrderCount: undefined,
        totalSlippageCostUsd: undefined
      });

      const result = await service.getSlippageSummary(mockUserId);

      expect(result.totalOrders).toBe(0);
      expect(result.avgSlippageBps).toBe(0);
    });
  });

  describe('getSlippageBySymbol', () => {
    it('should return slippage stats grouped by symbol', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([
        {
          symbol: 'BTC/USDT',
          avgSlippageBps: '25.5',
          minSlippageBps: '-10.0',
          maxSlippageBps: '75.25',
          stdDevBps: '15.5',
          orderCount: '50',
          favorableCount: '15',
          unfavorableCount: '35'
        },
        {
          symbol: 'ETH/USDT',
          avgSlippageBps: '18.0',
          minSlippageBps: '-5.0',
          maxSlippageBps: '45.0',
          stdDevBps: '10.0',
          orderCount: '30',
          favorableCount: '10',
          unfavorableCount: '20'
        }
      ]);

      const result = await service.getSlippageBySymbol(mockUserId);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        symbol: 'BTC/USDT',
        avgSlippageBps: 25.5,
        minSlippageBps: -10.0,
        maxSlippageBps: 75.25,
        stdDevBps: 15.5,
        orderCount: 50,
        favorableCount: 15,
        unfavorableCount: 35
      });
    });

    it('should default missing numeric values to 0', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([
        {
          symbol: 'BTC/USDT',
          avgSlippageBps: undefined,
          minSlippageBps: undefined,
          maxSlippageBps: undefined,
          stdDevBps: undefined,
          orderCount: undefined,
          favorableCount: undefined,
          unfavorableCount: undefined
        }
      ]);

      const result = await service.getSlippageBySymbol(mockUserId);

      expect(result[0]).toEqual({
        symbol: 'BTC/USDT',
        avgSlippageBps: 0,
        minSlippageBps: 0,
        maxSlippageBps: 0,
        stdDevBps: 0,
        orderCount: 0,
        favorableCount: 0,
        unfavorableCount: 0
      });
    });

    it('should return empty array when no data', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      const result = await service.getSlippageBySymbol(mockUserId);

      expect(result).toEqual([]);
    });

    it('should order by average slippage descending', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      await service.getSlippageBySymbol(mockUserId);

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('AVG(order.actualSlippageBps)', 'DESC');
    });
  });

  describe('getSlippageTrends', () => {
    it('should return daily slippage trends', async () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      mockQueryBuilder.getRawMany.mockResolvedValue([
        {
          date: yesterday,
          avgSlippageBps: '20.0',
          orderCount: '10'
        },
        {
          date: today,
          avgSlippageBps: '25.5',
          orderCount: '15'
        }
      ]);

      const result = await service.getSlippageTrends(mockUserId, '7d');

      expect(result).toHaveLength(2);
      expect(result[0].avgSlippageBps).toBe(20.0);
      expect(result[0].orderCount).toBe(10);
      expect(result[1].avgSlippageBps).toBe(25.5);
      expect(result[1].orderCount).toBe(15);
    });

    it('should use correct date range for 30d period', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      await service.getSlippageTrends(mockUserId, '30d');

      // Verify that andWhere was called with a date at least 29 days ago
      const andWhereCalls = mockQueryBuilder.andWhere.mock.calls;
      const dateCall = andWhereCalls.find((call: any) => call[0].includes('transactTime'));
      expect(dateCall).toBeDefined();
    });

    it('should use correct date range for 7d period', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      await service.getSlippageTrends(mockUserId, '7d');

      const andWhereCalls = mockQueryBuilder.andWhere.mock.calls;
      const dateCall = andWhereCalls.find((call: any) => call[0].includes('transactTime'));
      expect(dateCall).toBeDefined();
    });

    it('should use correct date range for 90d period', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      await service.getSlippageTrends(mockUserId, '90d');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalled();
    });

    it('should default to 30d period', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      await service.getSlippageTrends(mockUserId);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalled();
    });

    it('should handle string date responses', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([
        {
          date: '2024-01-15',
          avgSlippageBps: '20.0',
          orderCount: '10'
        }
      ]);

      const result = await service.getSlippageTrends(mockUserId);

      expect(result[0].date).toBe('2024-01-15');
    });

    it('should handle missing numeric values in trends', async () => {
      const today = new Date();
      mockQueryBuilder.getRawMany.mockResolvedValue([
        {
          date: today,
          avgSlippageBps: undefined,
          orderCount: undefined
        }
      ]);

      const result = await service.getSlippageTrends(mockUserId);

      expect(result[0].date).toBe(today.toISOString().split('T')[0]);
      expect(result[0].avgSlippageBps).toBe(0);
      expect(result[0].orderCount).toBe(0);
    });
  });

  describe('getHighSlippagePairs', () => {
    it('should return symbols with average slippage above threshold', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { symbol: 'BTC/USDT', avgSlippage: '75.5' },
        { symbol: 'ETH/USDT', avgSlippage: '60.0' }
      ]);

      const result = await service.getHighSlippagePairs(50);

      expect(result).toEqual(['BTC/USDT', 'ETH/USDT']);
      expect(mockQueryBuilder.having).toHaveBeenCalledWith('AVG(order.actualSlippageBps) > :threshold', {
        threshold: 50
      });
    });

    it('should use default threshold of 50 bps', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      await service.getHighSlippagePairs();

      expect(mockQueryBuilder.having).toHaveBeenCalledWith('AVG(order.actualSlippageBps) > :threshold', {
        threshold: 50
      });
    });

    it('should return empty array when no high slippage pairs', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      const result = await service.getHighSlippagePairs(100);

      expect(result).toEqual([]);
    });

    it('should order by average slippage descending', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      await service.getHighSlippagePairs();

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('avgSlippage', 'DESC');
    });

    it('should map symbols from result rows', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { symbol: 'SOL/USDT', avgSlippage: '55.5' },
        { symbol: 'AVAX/USDT', avgSlippage: '70.1' }
      ]);

      const result = await service.getHighSlippagePairs(50);

      expect(result).toEqual(['SOL/USDT', 'AVAX/USDT']);
    });
  });

  describe('getSlippageForSymbol', () => {
    it('should return slippage stats for specific symbol', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue({
        symbol: mockSymbol,
        avgSlippageBps: '22.5',
        minSlippageBps: '-8.0',
        maxSlippageBps: '65.0',
        stdDevBps: '12.0',
        orderCount: '25',
        favorableCount: '8',
        unfavorableCount: '17'
      });

      const result = await service.getSlippageForSymbol(mockUserId, mockSymbol);

      expect(result).toEqual({
        symbol: mockSymbol,
        avgSlippageBps: 22.5,
        minSlippageBps: -8.0,
        maxSlippageBps: 65.0,
        stdDevBps: 12.0,
        orderCount: 25,
        favorableCount: 8,
        unfavorableCount: 17
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('order.symbol = :symbol', { symbol: mockSymbol });
    });

    it('should return null when no data for symbol', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue(null);

      const result = await service.getSlippageForSymbol(mockUserId, 'UNKNOWN/PAIR');

      expect(result).toBeNull();
    });

    it('should default numeric values to 0 when missing', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue({
        symbol: mockSymbol,
        avgSlippageBps: undefined,
        minSlippageBps: undefined,
        maxSlippageBps: undefined,
        stdDevBps: undefined,
        orderCount: undefined,
        favorableCount: undefined,
        unfavorableCount: undefined
      });

      const result = await service.getSlippageForSymbol(mockUserId, mockSymbol);

      expect(result).toEqual({
        symbol: mockSymbol,
        avgSlippageBps: 0,
        minSlippageBps: 0,
        maxSlippageBps: 0,
        stdDevBps: 0,
        orderCount: 0,
        favorableCount: 0,
        unfavorableCount: 0
      });
    });

    it('should filter by user ID', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue(null);

      await service.getSlippageForSymbol(mockUserId, mockSymbol);

      expect(mockQueryBuilder.where).toHaveBeenCalledWith('order.userId = :userId', { userId: mockUserId });
    });
  });
});
