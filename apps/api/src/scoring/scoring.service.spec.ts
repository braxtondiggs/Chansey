import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { MarketRegimeType, StrategyGrade } from '@chansey/api-interfaces';

import { CalmarRatioCalculator } from './metrics/calmar-ratio.calculator';
import { ProfitFactorCalculator } from './metrics/profit-factor.calculator';
import { StabilityCalculator } from './metrics/stability.calculator';
import { WinRateCalculator } from './metrics/win-rate.calculator';
import { ScoringService } from './scoring.service';

import { CorrelationCalculator } from '../common/metrics/correlation.calculator';
import { DrawdownCalculator } from '../common/metrics/drawdown.calculator';
import { SharpeRatioCalculator } from '../common/metrics/sharpe-ratio.calculator';
import { StrategyScore } from '../strategy/entities/strategy-score.entity';

describe('ScoringService', () => {
  let service: ScoringService;
  let mockRepo: Record<string, jest.Mock>;

  /** Metrics that score "excellent" on every component → baseScore = 100 */
  const excellentMetrics = {
    sharpeRatio: 3.0,
    calmarRatio: 3.0,
    maxDrawdown: 0.05,
    winRate: 0.7,
    profitFactor: 2.5,
    totalTrades: 200,
    totalReturn: 0.5,
    volatility: 0.15
  };

  /** Metrics that score poorly on every component */
  const poorMetrics = {
    sharpeRatio: -1,
    calmarRatio: 0,
    maxDrawdown: 0.6,
    winRate: 0.1,
    profitFactor: 0.5,
    totalTrades: 2,
    totalReturn: -0.3,
    volatility: 2.0
  };

  beforeEach(async () => {
    mockRepo = {
      create: jest.fn((dto) => dto),
      save: jest.fn((entity) => Promise.resolve({ id: 'score-1', ...entity })),
      findOne: jest.fn(),
      find: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([])
      }))
    };

    const module = await Test.createTestingModule({
      providers: [
        ScoringService,
        SharpeRatioCalculator,
        DrawdownCalculator,
        CorrelationCalculator,
        CalmarRatioCalculator,
        WinRateCalculator,
        ProfitFactorCalculator,
        StabilityCalculator,
        { provide: getRepositoryToken(StrategyScore), useValue: mockRepo }
      ]
    }).compile();

    service = module.get(ScoringService);
  });

  describe('regime modifier', () => {
    it.each([
      [MarketRegimeType.LOW_VOLATILITY, 5],
      [MarketRegimeType.NORMAL, 0],
      [MarketRegimeType.HIGH_VOLATILITY, -5],
      [MarketRegimeType.EXTREME, -10]
    ])('returns correct modifier for %s regime (expected %i)', (regime, expected) => {
      const result = service.calculateScoreFromMetrics(excellentMetrics, 0, { marketRegime: regime });
      expect(result.regimeModifier).toBe(expected);
    });

    it('defaults to 0 when no regime is provided', () => {
      const result = service.calculateScoreFromMetrics(excellentMetrics, 0);
      expect(result.regimeModifier).toBe(0);
    });

    it('clamps overall score to [0, 100]', () => {
      const ceilingResult = service.calculateScoreFromMetrics(excellentMetrics, 0, {
        marketRegime: MarketRegimeType.LOW_VOLATILITY
      });
      expect(ceilingResult.overallScore).toBe(100);

      const floorResult = service.calculateScoreFromMetrics(poorMetrics, 80, {
        marketRegime: MarketRegimeType.EXTREME
      });
      expect(floorResult.overallScore).toBeGreaterThanOrEqual(0);
    });
  });

  describe('scoreMetric thresholds (via calculateScoreFromMetrics)', () => {
    it('assigns 100 to metrics at or above excellent threshold', () => {
      const result = service.calculateScoreFromMetrics(excellentMetrics, 0);
      expect(result.componentScores.sharpeRatio.score).toBe(100);
      expect(result.componentScores.calmarRatio.score).toBe(100);
      expect(result.componentScores.winRate.score).toBe(100);
      expect(result.componentScores.profitFactor.score).toBe(100);
    });

    it('assigns 75 to metrics in the "good" band', () => {
      const goodMetrics = {
        ...excellentMetrics,
        sharpeRatio: 1.5, // good: >= 1.0, < 2.0
        calmarRatio: 1.5,
        winRate: 0.55, // good: >= 0.5, < 0.6
        profitFactor: 1.7 // good: >= 1.5, < 2.0
      };
      const result = service.calculateScoreFromMetrics(goodMetrics, 0);
      expect(result.componentScores.sharpeRatio.score).toBe(75);
      expect(result.componentScores.calmarRatio.score).toBe(75);
      expect(result.componentScores.winRate.score).toBe(75);
      expect(result.componentScores.profitFactor.score).toBe(75);
    });

    it('assigns 50 to metrics in the "acceptable" band', () => {
      const acceptableMetrics = {
        ...excellentMetrics,
        sharpeRatio: 0.7, // acceptable: >= 0.5, < 1.0
        calmarRatio: 0.7,
        winRate: 0.47, // acceptable: >= 0.45, < 0.5
        profitFactor: 1.3 // acceptable: >= 1.2, < 1.5
      };
      const result = service.calculateScoreFromMetrics(acceptableMetrics, 0);
      expect(result.componentScores.sharpeRatio.score).toBe(50);
      expect(result.componentScores.calmarRatio.score).toBe(50);
      expect(result.componentScores.winRate.score).toBe(50);
      expect(result.componentScores.profitFactor.score).toBe(50);
    });

    it('assigns 25 to metrics in the "poor" band', () => {
      const metrics = {
        ...excellentMetrics,
        sharpeRatio: 0.3, // poor: >= 0, < 0.5
        calmarRatio: 0.3,
        winRate: 0.2, // poor: >= 0, < 0.45
        profitFactor: 1.05 // poor: >= 1.0, < 1.2
      };
      const result = service.calculateScoreFromMetrics(metrics, 0);
      expect(result.componentScores.sharpeRatio.score).toBe(25);
      expect(result.componentScores.calmarRatio.score).toBe(25);
      expect(result.componentScores.winRate.score).toBe(25);
      expect(result.componentScores.profitFactor.score).toBe(25);
    });

    it('assigns 0 to metrics below the "poor" threshold', () => {
      const belowPoor = {
        ...excellentMetrics,
        sharpeRatio: -1, // below 0
        winRate: -0.1 // below 0
      };
      const result = service.calculateScoreFromMetrics(belowPoor, 0);
      expect(result.componentScores.sharpeRatio.score).toBe(0);
      expect(result.componentScores.winRate.score).toBe(0);
    });
  });

  describe('scoreMetricInverse (WFA degradation)', () => {
    it('assigns 100 for low degradation (<= 10)', () => {
      const result = service.calculateScoreFromMetrics(excellentMetrics, 5);
      expect(result.componentScores.wfaDegradation.score).toBe(100);
    });

    it('assigns 75 for moderate degradation (11-20)', () => {
      const result = service.calculateScoreFromMetrics(excellentMetrics, 15);
      expect(result.componentScores.wfaDegradation.score).toBe(75);
    });

    it('assigns 50 for high degradation (21-30)', () => {
      const result = service.calculateScoreFromMetrics(excellentMetrics, 25);
      expect(result.componentScores.wfaDegradation.score).toBe(50);
    });

    it('assigns 25 for very high degradation (31-50)', () => {
      const result = service.calculateScoreFromMetrics(excellentMetrics, 40);
      expect(result.componentScores.wfaDegradation.score).toBe(25);
    });

    it('assigns 0 for extreme degradation (> 50)', () => {
      const result = service.calculateScoreFromMetrics(excellentMetrics, 60);
      expect(result.componentScores.wfaDegradation.score).toBe(0);
    });
  });

  describe('determineGrade (via calculateScoreFromMetrics)', () => {
    it('assigns grade A for scores >= 85', () => {
      const result = service.calculateScoreFromMetrics(excellentMetrics, 0);
      expect(result.overallScore).toBeGreaterThanOrEqual(85);
      expect(result.grade).toBe(StrategyGrade.A);
    });

    it('assigns grade F for very poor metrics', () => {
      const result = service.calculateScoreFromMetrics(poorMetrics, 80);
      expect(result.overallScore).toBeLessThan(40);
      expect(result.grade).toBe(StrategyGrade.F);
    });

    it('assigns intermediate grades for mid-range scores', () => {
      // Metrics that produce a moderate score (~50-70 range)
      const midMetrics = {
        ...excellentMetrics,
        sharpeRatio: 0.7,
        calmarRatio: 0.7,
        winRate: 0.47,
        profitFactor: 1.3,
        totalTrades: 35
      };
      const result = service.calculateScoreFromMetrics(midMetrics, 20);
      expect(result.grade).toMatch(/^[B-D]$/);
      expect(result.overallScore).toBeGreaterThanOrEqual(40);
      expect(result.overallScore).toBeLessThan(85);
    });
  });

  describe('generateWarnings', () => {
    it('returns no warnings for excellent metrics with low degradation', () => {
      const result = service.calculateScoreFromMetrics(excellentMetrics, 0);
      expect(result.warnings).toEqual([]);
    });

    it('warns on low Sharpe ratio', () => {
      const metrics = { ...excellentMetrics, sharpeRatio: 0.3 };
      const result = service.calculateScoreFromMetrics(metrics, 0);
      expect(result.warnings).toContain('Low Sharpe ratio indicates poor risk-adjusted returns');
    });

    it('warns on insufficient trades', () => {
      const metrics = { ...excellentMetrics, totalTrades: 10 };
      const result = service.calculateScoreFromMetrics(metrics, 0);
      expect(result.warnings).toContain('Insufficient trade count for statistical significance');
    });

    it('warns on high max drawdown', () => {
      const metrics = { ...excellentMetrics, maxDrawdown: 50 };
      const result = service.calculateScoreFromMetrics(metrics, 0);
      expect(result.warnings).toContain('High maximum drawdown exceeds 40% threshold');
    });

    it('warns on high WFA degradation', () => {
      const result = service.calculateScoreFromMetrics(excellentMetrics, 35);
      expect(result.warnings).toContain('High walk-forward degradation suggests overfitting');
    });

    it('warns on low win rate', () => {
      const metrics = { ...excellentMetrics, winRate: 0.3 };
      const result = service.calculateScoreFromMetrics(metrics, 0);
      expect(result.warnings).toContain('Low win rate below 45% threshold');
    });

    it('warns on high volatility', () => {
      const metrics = { ...excellentMetrics, volatility: 2.0 };
      const result = service.calculateScoreFromMetrics(metrics, 0);
      expect(result.warnings).toContain('High volatility exceeds 150% annualized threshold');
    });

    it('accumulates multiple warnings', () => {
      const result = service.calculateScoreFromMetrics(poorMetrics, 50);
      expect(result.warnings.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('calculateOverallScore (weighted sum)', () => {
    it('produces 100 when all components score excellent with 0 degradation', () => {
      const result = service.calculateScoreFromMetrics(excellentMetrics, 0);
      expect(result.overallScore).toBe(100);
    });

    it('produces a lower score when WFA degradation is high', () => {
      const low = service.calculateScoreFromMetrics(excellentMetrics, 5);
      const high = service.calculateScoreFromMetrics(excellentMetrics, 40);
      expect(low.overallScore).toBeGreaterThan(high.overallScore);
    });

    it('weights Sharpe ratio (25%) more heavily than win rate (10%)', () => {
      const lowSharpe = service.calculateScoreFromMetrics({ ...excellentMetrics, sharpeRatio: 0.3 }, 0);
      const lowWinRate = service.calculateScoreFromMetrics({ ...excellentMetrics, winRate: 0.2 }, 0);
      // Dropping Sharpe (25% weight) should hurt more than dropping win rate (10% weight)
      expect(lowSharpe.overallScore).toBeLessThan(lowWinRate.overallScore);
    });
  });

  describe('calculateScore (full pipeline)', () => {
    it('throws when backtest has no results', async () => {
      const backtestRun = { id: 'run-1', results: null } as any;
      await expect(service.calculateScore('strat-1', backtestRun, 10)).rejects.toThrow(
        'Backtest results not available'
      );
    });

    it('saves and returns a complete StrategyScore', async () => {
      const backtestRun = {
        id: 'run-1',
        results: excellentMetrics
      } as any;

      const result = await service.calculateScore('strat-1', backtestRun, 5);

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          strategyConfigId: 'strat-1',
          backtestRunIds: ['run-1'],
          promotionEligible: expect.any(Boolean),
          grade: expect.stringMatching(/^[A-F]$/),
          overallScore: expect.any(Number),
          warnings: expect.any(Array)
        })
      );
      expect(mockRepo.save).toHaveBeenCalled();
      expect(result.id).toBe('score-1');
    });
  });

  describe('checkPromotionEligibility (via calculateScore)', () => {
    it('is eligible with excellent metrics, low degradation, sufficient trades', async () => {
      const backtestRun = { id: 'run-1', results: excellentMetrics } as any;
      const result = await service.calculateScore('strat-1', backtestRun, 5);
      expect(result.promotionEligible).toBe(true);
    });

    it('is ineligible when totalTrades < 30', async () => {
      const backtestRun = {
        id: 'run-1',
        results: { ...excellentMetrics, totalTrades: 20 }
      } as any;
      const result = await service.calculateScore('strat-1', backtestRun, 5);
      expect(result.promotionEligible).toBe(false);
    });

    it('is ineligible when maxDrawdown exceeds 40%', async () => {
      const backtestRun = {
        id: 'run-1',
        results: { ...excellentMetrics, maxDrawdown: 50 }
      } as any;
      const result = await service.calculateScore('strat-1', backtestRun, 5);
      expect(result.promotionEligible).toBe(false);
    });

    it('is ineligible when totalReturn is non-positive', async () => {
      const backtestRun = {
        id: 'run-1',
        results: { ...excellentMetrics, totalReturn: -0.1 }
      } as any;
      const result = await service.calculateScore('strat-1', backtestRun, 5);
      expect(result.promotionEligible).toBe(false);
    });

    it('is ineligible when WFA degradation exceeds 30%', async () => {
      const backtestRun = {
        id: 'run-1',
        results: excellentMetrics
      } as any;
      const result = await service.calculateScore('strat-1', backtestRun, 35);
      expect(result.promotionEligible).toBe(false);
    });
  });
});
