import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { LessThan } from 'typeorm';

import { DeploymentMetricsService } from './deployment-metrics.service';
import type { Deployment } from './entities/deployment.entity';
import { PerformanceMetric } from './entities/performance-metric.entity';
import { PerformanceCalculationService } from './performance-calculation.service';
import { PositionTrackingService } from './position-tracking.service';

import { DrawdownCalculator } from '../common/metrics/drawdown.calculator';
import { SharpeRatioCalculator } from '../common/metrics/sharpe-ratio.calculator';
import { Order, OrderSide, OrderStatus } from '../order/order.entity';

describe('PerformanceCalculationService', () => {
  let service: PerformanceCalculationService;
  let orderRepo: any;
  let performanceMetricRepo: any;
  let positionTrackingService: any;
  let deploymentMetricsService: any;

  const mockDeployment = {
    id: 'deploy-1',
    strategyConfigId: 'strat-1',
    deployedAt: new Date('2024-01-01'),
    strategyConfig: { createdBy: 'user-1' }
  } as unknown as Deployment;

  const buildOrder = (overrides: Partial<Order> = {}): Order =>
    ({
      id: 'order-1',
      side: OrderSide.SELL,
      status: OrderStatus.FILLED,
      gainLoss: 0,
      price: 100,
      executedQuantity: 1,
      isAlgorithmicTrade: true,
      strategyConfigId: 'strat-1',
      createdAt: new Date(),
      ...overrides
    }) as unknown as Order;

  /** Sets up query builder mocks: first call = buyQb, subsequent = sellQb (SQL aggregate) */
  const mockQueryBuilders = (
    buyTotal: string,
    sellAgg: { total: string; wins: string; losses: string; grossProfit: string; grossLoss: string }
  ): void => {
    const sellQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue(sellAgg)
    };
    const buyQb = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ total: buyTotal })
    };
    let callCount = 0;
    orderRepo.createQueryBuilder.mockImplementation(() => {
      callCount++;
      return callCount === 1 ? buyQb : sellQb;
    });
  };

  beforeEach(async () => {
    orderRepo = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: '0', wins: '0', losses: '0', grossProfit: '0', grossLoss: '0' })
      })
    };

    performanceMetricRepo = {
      // First call = idempotency check (no existing metric), second call = previous metric lookup
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([])
    };

    positionTrackingService = {
      getPositions: jest.fn().mockResolvedValue([])
    };

    deploymentMetricsService = {
      recordPerformanceMetric: jest
        .fn()
        .mockImplementation((_dep, data) => Promise.resolve({ id: 'metric-1', ...data }))
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PerformanceCalculationService,
        SharpeRatioCalculator,
        DrawdownCalculator,
        { provide: getRepositoryToken(Order), useValue: orderRepo },
        { provide: getRepositoryToken(PerformanceMetric), useValue: performanceMetricRepo },
        { provide: PositionTrackingService, useValue: positionTrackingService },
        { provide: DeploymentMetricsService, useValue: deploymentMetricsService }
      ]
    }).compile();

    service = module.get(PerformanceCalculationService);
  });

  it('should calculate daily P&L, win/loss counts, and profit factor from mixed orders', async () => {
    const orders = [
      buildOrder({ side: OrderSide.BUY, gainLoss: undefined }),
      buildOrder({ side: OrderSide.SELL, gainLoss: 50 }),
      buildOrder({ side: OrderSide.SELL, gainLoss: -20 })
    ];
    orderRepo.find.mockResolvedValue(orders);

    mockQueryBuilders('1000', { total: '2', wins: '1', losses: '1', grossProfit: '50', grossLoss: '20' });

    await service.calculateMetrics(mockDeployment);

    expect(deploymentMetricsService.recordPerformanceMetric).toHaveBeenCalledWith(
      mockDeployment,
      expect.objectContaining({
        dailyPnl: 30,
        tradesCount: 3,
        winningTrades: 1,
        losingTrades: 1,
        winRate: 0.5,
        profitFactor: 2.5
      })
    );
  });

  it('should carry forward cumulative P&L and trade count when no trades today', async () => {
    const previousMetric = {
      cumulativePnl: 100,
      cumulativeReturn: 0.1,
      cumulativeTradesCount: 10,
      sharpeRatio: 1.5,
      maxDrawdown: 0.05,
      volatility: 0.2,
      dailyReturn: 0.01,
      metadata: { totalCapitalDeployed: 1000 }
    } as unknown as PerformanceMetric;

    // First call = idempotency (no existing), second call = previous metric
    performanceMetricRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(previousMetric);
    performanceMetricRepo.find.mockResolvedValue([
      { dailyReturn: 0.01 },
      { dailyReturn: -0.005 },
      { dailyReturn: 0.02 }
    ]);
    orderRepo.find.mockResolvedValue([]);

    await service.calculateMetrics(mockDeployment);

    expect(deploymentMetricsService.recordPerformanceMetric).toHaveBeenCalledWith(
      mockDeployment,
      expect.objectContaining({
        dailyPnl: 0,
        dailyReturn: 0,
        tradesCount: 0,
        cumulativePnl: 100,
        cumulativeTradesCount: 10
      })
    );
  });

  it('should return null Sharpe and volatility on first day with no prior data', async () => {
    orderRepo.find.mockResolvedValue([]);

    await service.calculateMetrics(mockDeployment);

    expect(deploymentMetricsService.recordPerformanceMetric).toHaveBeenCalledWith(
      mockDeployment,
      expect.objectContaining({
        dailyPnl: 0,
        dailyReturn: 0,
        cumulativePnl: 0,
        cumulativeReturn: 0,
        cumulativeTradesCount: 0,
        sharpeRatio: null,
        volatility: null
      })
    );
  });

  it('should return dailyReturn=0 when portfolioValue is zero (no division by zero)', async () => {
    const sellOrders = [buildOrder({ side: OrderSide.SELL, gainLoss: 10 })];
    orderRepo.find.mockResolvedValue(sellOrders);

    mockQueryBuilders('0', { total: '1', wins: '1', losses: '0', grossProfit: '10', grossLoss: '0' });

    await service.calculateMetrics(mockDeployment);

    expect(deploymentMetricsService.recordPerformanceMetric).toHaveBeenCalledWith(
      mockDeployment,
      expect.objectContaining({
        dailyReturn: 0
      })
    );
  });

  it('should throw when deployment has no createdBy user', async () => {
    const deploymentNoUser = {
      ...mockDeployment,
      strategyConfig: { createdBy: null }
    } as unknown as Deployment;

    await expect(service.calculateMetrics(deploymentNoUser)).rejects.toThrow('no createdBy user');
  });

  it('should compute Sharpe and volatility when sufficient prior metrics exist', async () => {
    performanceMetricRepo.findOne
      .mockResolvedValueOnce(null) // idempotency check
      .mockResolvedValueOnce({
        cumulativePnl: 50,
        cumulativeReturn: 0.05,
        cumulativeTradesCount: 5,
        metadata: { totalCapitalDeployed: 1000 }
      });
    performanceMetricRepo.find.mockResolvedValue([
      { dailyReturn: 0.02 },
      { dailyReturn: -0.01 },
      { dailyReturn: 0.015 }
    ]);
    orderRepo.find.mockResolvedValue([]);

    await service.calculateMetrics(mockDeployment);

    const call = deploymentMetricsService.recordPerformanceMetric.mock.calls[0][1];
    expect(call.sharpeRatio).not.toBeNull();
    expect(typeof call.sharpeRatio).toBe('number');
    expect(call.volatility).not.toBeNull();
    expect(typeof call.volatility).toBe('number');

    // Verify risk metrics query uses LessThan to exclude today's date
    const findCall = performanceMetricRepo.find.mock.calls[0];
    expect(findCall[0].where.date).toEqual(LessThan(expect.any(String)));
  });

  it('should return null winRate/profitFactor when there are no sell orders', async () => {
    const buyOnly = [buildOrder({ side: OrderSide.BUY, gainLoss: undefined })];
    orderRepo.find.mockResolvedValue(buyOnly);

    mockQueryBuilders('500', { total: '0', wins: '0', losses: '0', grossProfit: '0', grossLoss: '0' });

    await service.calculateMetrics(mockDeployment);

    expect(deploymentMetricsService.recordPerformanceMetric).toHaveBeenCalledWith(
      mockDeployment,
      expect.objectContaining({
        winRate: null,
        profitFactor: null,
        avgWinAmount: null,
        avgLossAmount: null
      })
    );
  });

  it('should return null profitFactor when all sells are winners (no losses)', async () => {
    const orders = [
      buildOrder({ side: OrderSide.SELL, gainLoss: 30 }),
      buildOrder({ side: OrderSide.SELL, gainLoss: 20 })
    ];
    orderRepo.find.mockResolvedValue(orders);

    mockQueryBuilders('1000', { total: '2', wins: '2', losses: '0', grossProfit: '50', grossLoss: '0' });

    await service.calculateMetrics(mockDeployment);

    const call = deploymentMetricsService.recordPerformanceMetric.mock.calls[0][1];
    // Infinity is converted to null in source (line 302)
    expect(call.profitFactor).toBeNull();
    expect(call.winRate).toBe(1);
  });

  it('should calculate position exposure and utilization from open positions', async () => {
    positionTrackingService.getPositions.mockResolvedValue([
      { quantity: '10', avgEntryPrice: 50 },
      { quantity: '0', avgEntryPrice: 100 },
      { quantity: '5', avgEntryPrice: 200 }
    ]);
    performanceMetricRepo.findOne
      .mockResolvedValueOnce(null) // idempotency check
      .mockResolvedValueOnce({
        cumulativePnl: 0,
        cumulativeReturn: 0,
        cumulativeTradesCount: 0,
        metadata: { totalCapitalDeployed: 2000 }
      });
    orderRepo.find.mockResolvedValue([]);

    await service.calculateMetrics(mockDeployment);

    const call = deploymentMetricsService.recordPerformanceMetric.mock.calls[0][1];
    // Open: 10*50 + 5*200 = 1500 exposure, portfolio=2000, utilization=0.75
    expect(call.openPositions).toBe(2);
    expect(call.exposureAmount).toBe(1500);
    expect(call.utilization).toBe(0.75);
  });

  it('should return existing metric when already calculated for today (idempotency)', async () => {
    const existingMetric = { id: 'metric-existing', deploymentId: 'deploy-1', date: '2024-06-15' };
    performanceMetricRepo.findOne.mockResolvedValueOnce(existingMetric);

    const result = await service.calculateMetrics(mockDeployment);

    expect(result).toBe(existingMetric);
    expect(deploymentMetricsService.recordPerformanceMetric).not.toHaveBeenCalled();
  });

  it('should return safe zeros when position tracking fails', async () => {
    positionTrackingService.getPositions.mockRejectedValue(new Error('DB connection lost'));
    orderRepo.find.mockResolvedValue([]);

    await service.calculateMetrics(mockDeployment);

    expect(deploymentMetricsService.recordPerformanceMetric).toHaveBeenCalledWith(
      mockDeployment,
      expect.objectContaining({
        openPositions: 0,
        exposureAmount: 0,
        utilization: 0
      })
    );
  });
});
