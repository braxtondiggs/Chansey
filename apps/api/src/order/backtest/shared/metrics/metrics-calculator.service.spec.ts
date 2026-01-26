import { Test, TestingModule } from '@nestjs/testing';

import { getPeriodsPerYear, MetricsConfig, TimeframeType, TradeMetrics } from './metrics-calculator.interface';
import { MetricsCalculatorService } from './metrics-calculator.service';

import { DrawdownCalculator } from '../../../../common/metrics/drawdown.calculator';
import { SharpeRatioCalculator } from '../../../../common/metrics/sharpe-ratio.calculator';

describe('MetricsCalculatorService', () => {
  let service: MetricsCalculatorService;
  let sharpeCalculator: SharpeRatioCalculator;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MetricsCalculatorService, SharpeRatioCalculator, DrawdownCalculator]
    }).compile();

    service = module.get<MetricsCalculatorService>(MetricsCalculatorService);
    sharpeCalculator = module.get<SharpeRatioCalculator>(SharpeRatioCalculator);
  });

  describe('calculateMetrics', () => {
    it('should calculate all metrics for profitable portfolio', () => {
      const portfolioValues = [10000, 10500, 10200, 10800, 11000, 11500, 11300, 12000];
      const trades: TradeMetrics[] = [
        { type: 'BUY', realizedPnL: 0 },
        { type: 'SELL', realizedPnL: 500 },
        { type: 'BUY', realizedPnL: 0 },
        { type: 'SELL', realizedPnL: -300 },
        { type: 'SELL', realizedPnL: 800 }
      ];

      const result = service.calculateMetrics({
        portfolioValues,
        initialCapital: 10000,
        trades
      });

      expect(result.finalValue).toBe(12000);
      expect(result.totalReturn).toBe(0.2); // 20% return
      expect(result.totalTrades).toBe(5);
      expect(result.winningTrades).toBe(2);
      expect(result.winRate).toBeCloseTo(0.6667, 2); // 2 winning / 3 sell trades
      expect(result.sharpeRatio).toBeDefined();
      expect(result.sortinoRatio).toBeDefined();
      expect(result.volatility).toBeGreaterThan(0);
    });

    it('should return empty metrics for empty portfolio values', () => {
      const result = service.calculateMetrics({
        portfolioValues: [],
        initialCapital: 10000
      });

      expect(result.sharpeRatio).toBe(0);
      expect(result.maxDrawdown).toBe(0);
      expect(result.winRate).toBe(0);
      expect(result.finalValue).toBe(10000);
    });

    it('should handle losing portfolio', () => {
      const portfolioValues = [10000, 9500, 9000, 8500, 8000];

      const result = service.calculateMetrics({
        portfolioValues,
        initialCapital: 10000,
        trades: [{ type: 'SELL', realizedPnL: -2000 }]
      });

      expect(result.totalReturn).toBe(-0.2); // -20% return
      expect(result.maxDrawdown).toBeGreaterThan(0);
      expect(result.winRate).toBe(0);
    });

    it('should use correct timeframe for annualization', () => {
      const portfolioValues = [10000, 10100, 10200, 10300];

      const dailyResult = service.calculateMetrics(
        { portfolioValues, initialCapital: 10000 },
        { timeframe: TimeframeType.DAILY, useCryptoCalendar: true }
      );

      const hourlyResult = service.calculateMetrics(
        { portfolioValues, initialCapital: 10000 },
        { timeframe: TimeframeType.HOURLY, useCryptoCalendar: true }
      );

      // Hourly should have higher annualized return (more periods to compound)
      expect(hourlyResult.annualizedReturn).toBeGreaterThan(dailyResult.annualizedReturn);
    });

    it('should annualize return based on configured periods', () => {
      const portfolioValues = [10000, 11000];

      const result = service.calculateMetrics({
        portfolioValues,
        initialCapital: 10000
      });

      expect(result.totalReturn).toBe(0.1);
      const periods = getPeriodsPerYear(TimeframeType.DAILY, true);
      const expectedAnnualized = Math.pow(1 + 0.1, periods / 1) - 1;
      expect(result.annualizedReturn).toBe(expectedAnnualized);
    });

    it('should ignore BUY trades when computing win rate and profit factor', () => {
      const portfolioValues = [10000, 10200, 10100, 10400];
      const trades: TradeMetrics[] = [
        { type: 'BUY', realizedPnL: 999 },
        { type: 'SELL', realizedPnL: 200 },
        { type: 'SELL', realizedPnL: -100 }
      ];

      const result = service.calculateMetrics({
        portfolioValues,
        initialCapital: 10000,
        trades
      });

      expect(result.winRate).toBe(0.5);
      expect(result.profitFactor).toBe(2);
    });
  });

  describe('calculateSharpeRatio', () => {
    it('should calculate Sharpe ratio with default config', () => {
      const returns = [0.01, 0.02, -0.01, 0.015, 0.005];

      const sharpe = service.calculateSharpeRatio(returns);

      expect(sharpe).toBeGreaterThan(0);
    });

    it('should return 0 for empty returns', () => {
      expect(service.calculateSharpeRatio([])).toBe(0);
    });

    it('should use correct periods for timeframe', () => {
      const returns = [0.01, 0.02, -0.01, 0.015, 0.005];

      const dailySharpe = service.calculateSharpeRatio(returns, { timeframe: TimeframeType.DAILY });
      const hourlySharpe = service.calculateSharpeRatio(returns, { timeframe: TimeframeType.HOURLY });

      // Different annualization factors should produce different Sharpe ratios
      expect(dailySharpe).not.toBe(hourlySharpe);
    });

    it('should match existing SharpeRatioCalculator output', () => {
      const returns = [0.01, 0.02, -0.01, 0.015, 0.005];
      const config: MetricsConfig = { timeframe: TimeframeType.DAILY, useCryptoCalendar: false };

      const serviceSharpe = service.calculateSharpeRatio(returns, config);
      const directSharpe = sharpeCalculator.calculate(returns, 0.02, 252);

      expect(serviceSharpe).toBeCloseTo(directSharpe, 10);
    });

    it('should decrease Sharpe when risk-free rate increases', () => {
      const returns = [0.01, 0.012, 0.011, 0.009, 0.013];
      const lowRf = service.calculateSharpeRatio(returns, {
        timeframe: TimeframeType.DAILY,
        useCryptoCalendar: true,
        riskFreeRate: 0.01
      });
      const highRf = service.calculateSharpeRatio(returns, {
        timeframe: TimeframeType.DAILY,
        useCryptoCalendar: true,
        riskFreeRate: 0.05
      });

      expect(highRf).toBeLessThan(lowRf);
    });
  });

  describe('calculateSortinoRatio', () => {
    it('should calculate Sortino ratio', () => {
      const returns = [0.01, 0.02, -0.01, 0.015, -0.005, 0.005];

      const sortino = service.calculateSortinoRatio(returns);

      expect(sortino).toBeGreaterThan(0);
    });

    it('should return 0 for empty returns', () => {
      expect(service.calculateSortinoRatio([])).toBe(0);
    });

    it('should be higher than Sharpe when few negative returns', () => {
      // Mostly positive returns
      const returns = [0.02, 0.015, 0.01, -0.002, 0.018, 0.012];

      const sharpe = service.calculateSharpeRatio(returns);
      const sortino = service.calculateSortinoRatio(returns);

      // Sortino should be higher since it only penalizes downside
      expect(sortino).toBeGreaterThanOrEqual(sharpe);
    });
  });

  describe('calculateMaxDrawdown', () => {
    it('should calculate max drawdown correctly', () => {
      const portfolioValues = [100, 110, 105, 120, 100, 115];

      const maxDrawdown = service.calculateMaxDrawdown(portfolioValues);

      // Peak at 120, trough at 100, drawdown = 20/120 = 16.67%
      expect(maxDrawdown).toBeCloseTo(0.1667, 2);
    });

    it('should return 0 for monotonically increasing values', () => {
      const portfolioValues = [100, 110, 120, 130, 140];

      const maxDrawdown = service.calculateMaxDrawdown(portfolioValues);

      expect(maxDrawdown).toBe(0);
    });

    it('should return 0 for empty array', () => {
      expect(service.calculateMaxDrawdown([])).toBe(0);
    });
  });

  describe('calculateWinRate', () => {
    it('should calculate win rate from sell trades', () => {
      const trades: TradeMetrics[] = [
        { type: 'BUY', realizedPnL: 0 },
        { type: 'SELL', realizedPnL: 500 },
        { type: 'SELL', realizedPnL: -200 },
        { type: 'SELL', realizedPnL: 300 },
        { type: 'SELL', realizedPnL: -100 }
      ];

      const winRate = service.calculateWinRate(trades);

      // 2 winning / 4 sell trades = 50%
      expect(winRate).toBe(0.5);
    });

    it('should return 0 for no trades', () => {
      expect(service.calculateWinRate([])).toBe(0);
    });

    it('should ignore BUY trades', () => {
      const trades: TradeMetrics[] = [
        { type: 'BUY', realizedPnL: 1000 },
        { type: 'BUY', realizedPnL: 2000 }
      ];

      const winRate = service.calculateWinRate(trades);

      expect(winRate).toBe(0);
    });
  });

  describe('calculateProfitFactor', () => {
    it('should calculate profit factor', () => {
      const trades: TradeMetrics[] = [
        { type: 'SELL', realizedPnL: 1000 },
        { type: 'SELL', realizedPnL: 500 },
        { type: 'SELL', realizedPnL: -300 },
        { type: 'SELL', realizedPnL: -200 }
      ];

      const profitFactor = service.calculateProfitFactor(trades);

      // Gross profit: 1500, Gross loss: 500
      expect(profitFactor).toBe(3);
    });

    it('should return Infinity when no losses', () => {
      const trades: TradeMetrics[] = [
        { type: 'SELL', realizedPnL: 1000 },
        { type: 'SELL', realizedPnL: 500 }
      ];

      const profitFactor = service.calculateProfitFactor(trades);

      expect(profitFactor).toBe(Infinity);
    });

    it('should return 1 when no trades', () => {
      expect(service.calculateProfitFactor([])).toBe(1);
    });

    it('should handle break-even scenario', () => {
      const trades: TradeMetrics[] = [
        { type: 'SELL', realizedPnL: 500 },
        { type: 'SELL', realizedPnL: -500 }
      ];

      const profitFactor = service.calculateProfitFactor(trades);

      expect(profitFactor).toBe(1);
    });
  });

  describe('calculateVolatility', () => {
    it('should calculate annualized volatility', () => {
      const returns = [0.01, 0.02, -0.01, 0.015, 0.005];

      const volatility = service.calculateVolatility(returns);

      expect(volatility).toBeGreaterThan(0);
    });

    it('should return 0 for empty returns', () => {
      expect(service.calculateVolatility([])).toBe(0);
    });

    it('should return 0 for constant returns', () => {
      const returns = [0.01, 0.01, 0.01, 0.01];

      const volatility = service.calculateVolatility(returns);

      expect(volatility).toBe(0);
    });

    it('should scale with timeframe', () => {
      const returns = [0.01, 0.02, -0.01, 0.015, 0.005];

      const dailyVol = service.calculateVolatility(returns, { timeframe: TimeframeType.DAILY });
      const hourlyVol = service.calculateVolatility(returns, { timeframe: TimeframeType.HOURLY });

      // Hourly has more periods, so higher annualized vol
      expect(hourlyVol).toBeGreaterThan(dailyVol);
    });
  });

  describe('calculateDownsideDeviation', () => {
    it('should calculate downside deviation', () => {
      const returns = [0.01, 0.02, -0.01, -0.02, 0.015, -0.005];

      const downsideDev = service.calculateDownsideDeviation(returns);

      expect(downsideDev).toBeGreaterThan(0);
    });

    it('should return 0 for empty returns', () => {
      expect(service.calculateDownsideDeviation([])).toBe(0);
    });

    it('should return 0 when all returns above risk-free', () => {
      // All returns above daily risk-free rate (0.02/365 ≈ 0.000055)
      const returns = [0.01, 0.02, 0.015, 0.025];

      const downsideDev = service.calculateDownsideDeviation(returns);

      expect(downsideDev).toBe(0);
    });

    it('should be less than or equal to total volatility', () => {
      const returns = [0.01, 0.02, -0.01, -0.02, 0.015, -0.005];

      const volatility = service.calculateVolatility(returns);
      const downsideDev = service.calculateDownsideDeviation(returns);

      expect(downsideDev).toBeLessThanOrEqual(volatility);
    });

    it('should increase downside deviation with higher risk-free rate', () => {
      const returns = [0.0001, -0.0001, 0.0002, -0.00005];
      const lowRf = service.calculateDownsideDeviation(returns, {
        timeframe: TimeframeType.DAILY,
        useCryptoCalendar: true,
        riskFreeRate: 0.01
      });
      const highRf = service.calculateDownsideDeviation(returns, {
        timeframe: TimeframeType.DAILY,
        useCryptoCalendar: true,
        riskFreeRate: 0.1
      });

      expect(highRf).toBeGreaterThan(lowRf);
    });
  });

  describe('calculateReturns', () => {
    it('should convert portfolio values to returns', () => {
      const portfolioValues = [100, 110, 105, 115];

      const returns = service.calculateReturns(portfolioValues);

      expect(returns).toHaveLength(3);
      expect(returns[0]).toBeCloseTo(0.1, 5); // (110-100)/100
      expect(returns[1]).toBeCloseTo(-0.0455, 3); // (105-110)/110
      expect(returns[2]).toBeCloseTo(0.0952, 3); // (115-105)/105
    });

    it('should return empty array for single value', () => {
      expect(service.calculateReturns([100])).toEqual([]);
    });

    it('should return empty array for empty input', () => {
      expect(service.calculateReturns([])).toEqual([]);
    });

    it('should handle zero value gracefully', () => {
      const portfolioValues = [100, 0, 50];

      const returns = service.calculateReturns(portfolioValues);

      expect(returns[0]).toBe(-1); // (0-100)/100
      expect(returns[1]).toBe(0); // (50-0)/0 -> 0 to avoid NaN
    });
  });

  describe('getPeriodsPerYear', () => {
    it('should return correct periods for crypto calendar', () => {
      expect(getPeriodsPerYear(TimeframeType.HOURLY, true)).toBe(8760);
      expect(getPeriodsPerYear(TimeframeType.DAILY, true)).toBe(365);
      expect(getPeriodsPerYear(TimeframeType.WEEKLY, true)).toBe(52);
      expect(getPeriodsPerYear(TimeframeType.MONTHLY, true)).toBe(12);
    });

    it('should return correct periods for traditional calendar', () => {
      expect(getPeriodsPerYear(TimeframeType.DAILY, false)).toBe(252);
    });

    it('should return correct periods for hourly traditional calendar', () => {
      expect(getPeriodsPerYear(TimeframeType.HOURLY, false)).toBe(6552);
    });
  });
});
