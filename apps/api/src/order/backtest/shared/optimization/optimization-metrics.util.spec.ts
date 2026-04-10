import { calculateOptimizationMetrics } from './optimization-metrics.util';

import { type BacktestTrade, TradeType } from '../../backtest-trade.entity';
import { type MetricsCalculatorService, TimeframeType } from '../metrics';

describe('calculateOptimizationMetrics', () => {
  const mockMetricsCalculator = {
    calculateSharpeRatio: jest.fn().mockReturnValue(1.5)
  } as unknown as MetricsCalculatorService;

  const makeSnapshots = (...entries: [number, string][]) =>
    entries.map(([value, date]) => ({ portfolioValue: value, timestamp: new Date(date) }));

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should compute all metrics correctly for a mixed-trade scenario', () => {
    const trades: Partial<BacktestTrade>[] = [
      { type: TradeType.BUY, realizedPnL: 0 },
      { type: TradeType.SELL, realizedPnL: 100 },
      { type: TradeType.BUY, realizedPnL: 0 },
      { type: TradeType.SELL, realizedPnL: -30 },
      { type: TradeType.BUY, realizedPnL: 0 },
      { type: TradeType.SELL, realizedPnL: 50 }
    ];

    const snapshots = makeSnapshots(
      [10000, '2024-01-01'],
      [10100, '2024-02-01'],
      [10070, '2024-03-01'],
      [10120, '2024-04-01']
    );

    const result = calculateOptimizationMetrics(
      trades,
      snapshots,
      10120,
      0.003,
      10000,
      new Date('2024-01-01'),
      new Date('2024-04-01'),
      mockMetricsCalculator
    );

    // Core metrics
    expect(result.tradeCount).toBe(6);
    expect(result.totalReturn).toBeCloseTo(0.012, 3);
    expect(result.maxDrawdown).toBe(0.003);
    expect(result.finalValue).toBe(10120);
    expect(result.sharpeRatio).toBe(1.5);

    // Win rate: 2 winners (100, 50) / 3 sell trades
    expect(result.winRate).toBeCloseTo(2 / 3, 4);

    // Profit factor: grossProfit 150 / grossLoss 30
    expect(result.profitFactor).toBeCloseTo(5, 4);

    // Annualized return: (1 + 0.012)^(365/91) - 1
    const durationDays = 91; // Jan 1 → Apr 1
    const expectedAnnualized = Math.pow(1 + 0.012, 365 / durationDays) - 1;
    expect(result.annualizedReturn).toBeCloseTo(expectedAnnualized, 4);

    // Volatility: stddev of period returns × sqrt(365)
    const returns = [
      (10100 - 10000) / 10000, // 0.01
      (10070 - 10100) / 10100, // -0.00297...
      (10120 - 10070) / 10070 //  0.00496...
    ];
    const avg = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - avg) ** 2, 0) / returns.length;
    const expectedVolatility = Math.sqrt(variance) * Math.sqrt(365);
    expect(result.volatility).toBeCloseTo(expectedVolatility, 4);

    // Downside deviation: only returns below risk-free rate per period
    const periodRfr = 0.02 / 365;
    const downside = returns.filter((r) => r < periodRfr);
    const dsVariance = downside.reduce((s, r) => s + (r - periodRfr) ** 2, 0) / returns.length;
    const expectedDownside = Math.sqrt(dsVariance) * Math.sqrt(365);
    expect(result.downsideDeviation).toBeCloseTo(expectedDownside, 4);
  });

  it('should delegate sharpe ratio to metricsCalculator with correct args', () => {
    const snapshots = makeSnapshots([10000, '2024-01-01'], [10100, '2024-02-01']);

    calculateOptimizationMetrics(
      [],
      snapshots,
      10100,
      0,
      10000,
      new Date('2024-01-01'),
      new Date('2024-02-01'),
      mockMetricsCalculator
    );

    expect(mockMetricsCalculator.calculateSharpeRatio).toHaveBeenCalledWith([0.01], {
      timeframe: TimeframeType.DAILY,
      useCryptoCalendar: true,
      riskFreeRate: 0.02
    });
  });

  it('should return safe defaults when there are zero trades', () => {
    const result = calculateOptimizationMetrics(
      [],
      makeSnapshots([10000, '2024-01-01'], [10000, '2024-04-01']),
      10000,
      0,
      10000,
      new Date('2024-01-01'),
      new Date('2024-04-01'),
      mockMetricsCalculator
    );

    expect(result.tradeCount).toBe(0);
    expect(result.totalReturn).toBe(0);
    expect(result.maxDrawdown).toBe(0);
    expect(result.winRate).toBe(0);
    expect(result.profitFactor).toBe(1);
    expect(result.finalValue).toBe(10000);
    expect(result.volatility).toBe(0);
    expect(result.annualizedReturn).toBe(0);
  });

  it('should cap profitFactor at 10 when grossLoss is zero or ratio exceeds cap', () => {
    // All-winners: grossLoss=0 → Infinity → capped
    const allWinners: Partial<BacktestTrade>[] = [
      { type: TradeType.SELL, realizedPnL: 500 },
      { type: TradeType.SELL, realizedPnL: 300 }
    ];

    const result1 = calculateOptimizationMetrics(
      allWinners,
      makeSnapshots([10000, '2024-01-01'], [10800, '2024-04-01']),
      10800,
      0,
      10000,
      new Date('2024-01-01'),
      new Date('2024-04-01'),
      mockMetricsCalculator
    );
    expect(result1.profitFactor).toBe(10);
    expect(result1.winRate).toBe(1);

    // Huge ratio: 5000/1 = 5000 → capped at 10
    const hugeRatio: Partial<BacktestTrade>[] = [
      { type: TradeType.SELL, realizedPnL: 5000 },
      { type: TradeType.SELL, realizedPnL: -1 }
    ];

    const result2 = calculateOptimizationMetrics(
      hugeRatio,
      makeSnapshots([10000, '2024-01-01'], [14999, '2024-04-01']),
      14999,
      0,
      10000,
      new Date('2024-01-01'),
      new Date('2024-04-01'),
      mockMetricsCalculator
    );
    expect(result2.profitFactor).toBe(10);
  });

  it('should return raw totalReturn as annualizedReturn when durationDays is 0', () => {
    const sameDate = new Date('2024-06-15');
    const result = calculateOptimizationMetrics(
      [],
      [{ portfolioValue: 10000, timestamp: sameDate }],
      10500,
      0,
      10000,
      sameDate,
      sameDate,
      mockMetricsCalculator
    );

    expect(result.totalReturn).toBeCloseTo(0.05, 4);
    expect(result.annualizedReturn).toBe(result.totalReturn);
  });

  it('should treat undefined realizedPnL as 0', () => {
    const trades: Partial<BacktestTrade>[] = [
      { type: TradeType.SELL, realizedPnL: undefined },
      { type: TradeType.SELL, realizedPnL: 100 }
    ];

    const result = calculateOptimizationMetrics(
      trades,
      makeSnapshots([10000, '2024-01-01'], [10100, '2024-04-01']),
      10100,
      0,
      10000,
      new Date('2024-01-01'),
      new Date('2024-04-01'),
      mockMetricsCalculator
    );

    // undefined PnL → 0 → not a winner, not a loser
    expect(result.winRate).toBe(0.5);
    // grossProfit=100, grossLoss=0 → Infinity → capped at 10
    expect(result.profitFactor).toBe(10);
  });

  it('should handle zero-value snapshot without dividing by zero', () => {
    const result = calculateOptimizationMetrics(
      [],
      makeSnapshots([0, '2024-01-01'], [10000, '2024-02-01']),
      10000,
      0,
      10000,
      new Date('2024-01-01'),
      new Date('2024-02-01'),
      mockMetricsCalculator
    );

    // previous === 0 guard pushes 0 return instead of NaN/Infinity
    expect(result.volatility).toBe(0);
    expect(Number.isFinite(result.downsideDeviation)).toBe(true);
  });
});
