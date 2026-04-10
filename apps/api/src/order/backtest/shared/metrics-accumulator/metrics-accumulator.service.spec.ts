import { MetricsAccumulatorService, MetricsAccumulator } from './metrics-accumulator.service';

import { BacktestPerformanceSnapshot } from '../../backtest-performance-snapshot.entity';
import { BacktestTrade, TradeType } from '../../backtest-trade.entity';
import { CheckpointService } from '../checkpoint';
import { MetricsCalculatorService } from '../metrics';

describe('MetricsAccumulatorService', () => {
  let service: MetricsAccumulatorService;
  let metricsCalculator: jest.Mocked<MetricsCalculatorService>;

  beforeEach(() => {
    metricsCalculator = {
      calculateSharpeRatio: jest.fn().mockReturnValue(1.5)
    } as unknown as jest.Mocked<MetricsCalculatorService>;

    const checkpointSvc = new CheckpointService();
    service = new MetricsAccumulatorService(metricsCalculator, checkpointSvc);
  });

  describe('createMetricsAccumulator', () => {
    it('should create accumulator with default zero values', () => {
      const acc = service.createMetricsAccumulator();

      expect(acc.totalTradeCount).toBe(0);
      expect(acc.totalSellCount).toBe(0);
      expect(acc.totalWinningSellCount).toBe(0);
      expect(acc.grossProfit).toBe(0);
      expect(acc.grossLoss).toBe(0);
      expect(acc.skippedBuyCount).toBe(0);
      expect(acc.snapshotValues).toEqual([]);
    });

    it('should create accumulator with provided initial values', () => {
      const acc = service.createMetricsAccumulator(10, 5, 3, 1000, 200);

      expect(acc.totalTradeCount).toBe(10);
      expect(acc.totalSellCount).toBe(5);
      expect(acc.totalWinningSellCount).toBe(3);
      expect(acc.grossProfit).toBe(1000);
      expect(acc.grossLoss).toBe(200);
    });

    it('should have functional callbacks that mutate the accumulator', () => {
      const acc = service.createMetricsAccumulator();

      acc.callbacks.addTradeCount(3);
      acc.callbacks.addSellCount(2);
      acc.callbacks.addWinningSellCount(1);
      acc.callbacks.addGrossProfit(500);
      acc.callbacks.addGrossLoss(100);
      acc.callbacks.addSnapshotValues([10000, 10500]);

      expect(acc.totalTradeCount).toBe(3);
      expect(acc.totalSellCount).toBe(2);
      expect(acc.totalWinningSellCount).toBe(1);
      expect(acc.grossProfit).toBe(500);
      expect(acc.grossLoss).toBe(100);
      expect(acc.snapshotValues).toEqual([10000, 10500]);
    });

    it('should accumulate across multiple callback invocations', () => {
      const acc = service.createMetricsAccumulator(5, 2, 1, 300, 50);

      acc.callbacks.addTradeCount(3);
      acc.callbacks.addTradeCount(2);
      acc.callbacks.addGrossProfit(200);

      expect(acc.totalTradeCount).toBe(10);
      expect(acc.grossProfit).toBe(500);
    });
  });

  describe('harvestMetrics', () => {
    let acc: MetricsAccumulator;

    beforeEach(() => {
      acc = service.createMetricsAccumulator();
    });

    it('should increment trade count from trades array length', () => {
      const trades: Partial<BacktestTrade>[] = [
        { type: TradeType.BUY },
        { type: TradeType.BUY },
        { type: TradeType.SELL, realizedPnL: 100 }
      ];
      const snapshots: Partial<BacktestPerformanceSnapshot>[] = [];

      service.harvestMetrics(trades, snapshots, acc.callbacks);

      expect(acc.totalTradeCount).toBe(3);
    });

    it('should count sells and winning sells correctly', () => {
      const trades: Partial<BacktestTrade>[] = [
        { type: TradeType.SELL, realizedPnL: 100 },
        { type: TradeType.SELL, realizedPnL: -50 },
        { type: TradeType.SELL, realizedPnL: 200 },
        { type: TradeType.BUY }
      ];
      const snapshots: Partial<BacktestPerformanceSnapshot>[] = [];

      service.harvestMetrics(trades, snapshots, acc.callbacks);

      expect(acc.totalSellCount).toBe(3);
      expect(acc.totalWinningSellCount).toBe(2);
      expect(acc.grossProfit).toBe(300);
      expect(acc.grossLoss).toBe(50);
    });

    it('should collect snapshot values from portfolio values', () => {
      const trades: Partial<BacktestTrade>[] = [];
      const snapshots: Partial<BacktestPerformanceSnapshot>[] = [
        { portfolioValue: 10000 },
        { portfolioValue: 10500 },
        { portfolioValue: 10200 }
      ];

      service.harvestMetrics(trades, snapshots, acc.callbacks);

      expect(acc.snapshotValues).toEqual([10000, 10500, 10200]);
    });

    it('should default missing portfolio values to 0', () => {
      const trades: Partial<BacktestTrade>[] = [];
      const snapshots: Partial<BacktestPerformanceSnapshot>[] = [{ portfolioValue: undefined }, {}];

      service.harvestMetrics(trades, snapshots, acc.callbacks);

      expect(acc.snapshotValues).toEqual([0, 0]);
    });

    it('should handle sells with zero PnL as neither winning nor losing', () => {
      const trades: Partial<BacktestTrade>[] = [{ type: TradeType.SELL, realizedPnL: 0 }];

      service.harvestMetrics(trades, [], acc.callbacks);

      expect(acc.totalSellCount).toBe(1);
      expect(acc.totalWinningSellCount).toBe(0);
      expect(acc.grossProfit).toBe(0);
      expect(acc.grossLoss).toBe(0);
    });

    it('should handle sells with undefined realizedPnL as zero', () => {
      const trades: Partial<BacktestTrade>[] = [{ type: TradeType.SELL, realizedPnL: undefined }];

      service.harvestMetrics(trades, [], acc.callbacks);

      expect(acc.totalSellCount).toBe(1);
      expect(acc.totalWinningSellCount).toBe(0);
      expect(acc.grossProfit).toBe(0);
      expect(acc.grossLoss).toBe(0);
    });
  });

  describe('calculateFinalMetricsFromAccumulators', () => {
    it('should compute final metrics using metricsCalculator for Sharpe', () => {
      const portfolio = {
        totalValue: 12000,
        cashBalance: 2000,
        positions: new Map()
      } as unknown as import('../portfolio').Portfolio;

      const result = service.calculateFinalMetricsFromAccumulators(
        10000,
        new Date('2024-01-01'),
        new Date('2024-12-31'),
        portfolio,
        20,
        10,
        7,
        [10000, 10500, 11000, 11500, 12000],
        0.15,
        700,
        300
      );

      expect(result.finalValue).toBe(12000);
      expect(result.totalReturn).toBeCloseTo(0.2);
      expect(result.totalTrades).toBe(20);
      expect(result.winningTrades).toBe(7);
      expect(result.losingTrades).toBe(3);
      expect(result.winRate).toBeCloseTo(0.7);
      expect(result.maxDrawdown).toBe(0.15);
      expect(result.sharpeRatio).toBe(1.5);
      expect(metricsCalculator.calculateSharpeRatio).toHaveBeenCalled();
    });

    it('should return zero Sharpe when no snapshot values', () => {
      const portfolio = {
        totalValue: 10000,
        cashBalance: 10000,
        positions: new Map()
      } as unknown as import('../portfolio').Portfolio;

      const result = service.calculateFinalMetricsFromAccumulators(
        10000,
        new Date('2024-01-01'),
        new Date('2024-12-31'),
        portfolio,
        0,
        0,
        0,
        [],
        0,
        0,
        0
      );

      expect(result.sharpeRatio).toBe(0);
      expect(metricsCalculator.calculateSharpeRatio).not.toHaveBeenCalled();
    });

    it('should cap profit factor at 10', () => {
      const portfolio = {
        totalValue: 20000,
        cashBalance: 20000,
        positions: new Map()
      } as unknown as import('../portfolio').Portfolio;

      const result = service.calculateFinalMetricsFromAccumulators(
        10000,
        new Date('2024-01-01'),
        new Date('2024-12-31'),
        portfolio,
        10,
        5,
        5,
        [10000, 20000],
        0,
        10000,
        0 // zero gross loss -> would be infinite
      );

      expect(result.profitFactor).toBe(10);
    });

    it('should return 1 profit factor when no profit and no loss', () => {
      const portfolio = {
        totalValue: 10000,
        cashBalance: 10000,
        positions: new Map()
      } as unknown as import('../portfolio').Portfolio;

      const result = service.calculateFinalMetricsFromAccumulators(
        10000,
        new Date('2024-01-01'),
        new Date('2024-12-31'),
        portfolio,
        0,
        0,
        0,
        [10000],
        0,
        0,
        0
      );

      expect(result.profitFactor).toBe(1);
    });

    it('should handle zero-duration backtests', () => {
      const portfolio = {
        totalValue: 10500,
        cashBalance: 10500,
        positions: new Map()
      } as unknown as import('../portfolio').Portfolio;

      const result = service.calculateFinalMetricsFromAccumulators(
        10000,
        new Date('2024-06-01'),
        new Date('2024-06-01'),
        portfolio,
        1,
        0,
        0,
        [10000, 10500],
        0,
        0,
        0
      );

      // With zero duration days, annualizedReturn = totalReturn
      expect(result.annualizedReturn).toBeCloseTo(result.totalReturn);
    });

    it('should compute normal profit factor when both profit and loss exist', () => {
      const portfolio = {
        totalValue: 11000,
        cashBalance: 11000,
        positions: new Map()
      } as unknown as import('../portfolio').Portfolio;

      const result = service.calculateFinalMetricsFromAccumulators(
        10000,
        new Date('2024-01-01'),
        new Date('2024-12-31'),
        portfolio,
        10,
        6,
        4,
        [10000, 10500, 11000],
        0.05,
        800,
        200
      );

      expect(result.profitFactor).toBe(4); // 800 / 200
    });

    it('should compute annualized volatility from return series', () => {
      const portfolio = {
        totalValue: 12000,
        cashBalance: 12000,
        positions: new Map()
      } as unknown as import('../portfolio').Portfolio;

      const result = service.calculateFinalMetricsFromAccumulators(
        10000,
        new Date('2024-01-01'),
        new Date('2024-12-31'),
        portfolio,
        5,
        2,
        1,
        [10000, 10500, 9800, 10200, 12000],
        0.05,
        500,
        200
      );

      expect(result.volatility).toBeGreaterThan(0);
    });

    it('should return zero volatility when no snapshot values', () => {
      const portfolio = {
        totalValue: 10000,
        cashBalance: 10000,
        positions: new Map()
      } as unknown as import('../portfolio').Portfolio;

      const result = service.calculateFinalMetricsFromAccumulators(
        10000,
        new Date('2024-01-01'),
        new Date('2024-12-31'),
        portfolio,
        0,
        0,
        0,
        [],
        0,
        0,
        0
      );

      expect(result.volatility).toBe(0);
    });

    it('should handle zero-valued snapshot in returns calculation', () => {
      const portfolio = {
        totalValue: 10000,
        cashBalance: 10000,
        positions: new Map()
      } as unknown as import('../portfolio').Portfolio;

      // A zero snapshot value triggers the `previous === 0 ? 0` guard
      const result = service.calculateFinalMetricsFromAccumulators(
        10000,
        new Date('2024-01-01'),
        new Date('2024-12-31'),
        portfolio,
        2,
        1,
        1,
        [0, 10000],
        0,
        100,
        0
      );

      // Should not produce NaN/Infinity from division by zero
      expect(Number.isFinite(result.sharpeRatio)).toBe(true);
    });

    it('should compute win rate as 0 when no sell trades', () => {
      const portfolio = {
        totalValue: 10000,
        cashBalance: 10000,
        positions: new Map()
      } as unknown as import('../portfolio').Portfolio;

      const result = service.calculateFinalMetricsFromAccumulators(
        10000,
        new Date('2024-01-01'),
        new Date('2024-12-31'),
        portfolio,
        5,
        0,
        0,
        [10000],
        0,
        0,
        0
      );

      expect(result.winRate).toBe(0);
    });
  });
});
