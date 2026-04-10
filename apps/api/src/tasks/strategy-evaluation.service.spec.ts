import { PASS_THRESHOLD, StrategyEvaluationService } from './strategy-evaluation.service';

import type { BacktestFinalMetrics } from '../order/backtest/backtest-result.service';
import { BacktestStatus } from '../order/backtest/backtest.entity';

describe('StrategyEvaluationService', () => {
  const createService = () => {
    const backtestRepo = {
      create: jest.fn((data: any) => ({ ...data, id: 'backtest-1' })),
      save: jest.fn((entity: any) => Promise.resolve({ ...entity, id: entity.id ?? 'backtest-1' }))
    };

    const backtestRunRepo = {
      create: jest.fn((data: any) => ({ ...data, id: 'run-1' })),
      save: jest.fn((entity: any) => Promise.resolve({ ...entity, id: entity.id ?? 'run-1' }))
    };

    const strategyConfigRepo = {
      findOne: jest.fn()
    };

    const userRepo = {
      findOne: jest.fn()
    };

    const strategyService = {
      getStrategyInstance: jest.fn().mockResolvedValue({ config: { param1: 'value1' } })
    };

    const backtestEngine = {
      executeHistoricalBacktest: jest.fn()
    };

    const backtestResultService = {
      persistSuccess: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined)
    };

    const backtestDatasetService = {
      ensureDefaultDatasetExists: jest.fn()
    };

    const coinResolver = {
      resolveCoins: jest.fn()
    };

    const scoringService = {
      calculateScore: jest.fn()
    };

    const service = new StrategyEvaluationService(
      backtestRepo as any,
      backtestRunRepo as any,
      strategyConfigRepo as any,
      userRepo as any,
      strategyService as any,
      backtestEngine as any,
      backtestResultService as any,
      backtestDatasetService as any,
      coinResolver as any,
      scoringService as any
    );

    return {
      service,
      backtestRepo,
      backtestRunRepo,
      strategyConfigRepo,
      userRepo,
      strategyService,
      backtestEngine,
      backtestResultService,
      backtestDatasetService,
      coinResolver,
      scoringService
    };
  };

  const mockDataset = {
    id: 'dataset-1',
    startAt: '2024-01-01T00:00:00Z',
    endAt: '2024-06-01T00:00:00Z'
  };

  const mockStrategy = {
    id: 'strategy-1',
    name: 'Test Strategy',
    algorithm: { id: 'algo-1', strategyId: 'rsi-momentum-001' },
    creator: { id: 'user-1', algoTradingEnabled: true }
  };

  const mockMetrics: BacktestFinalMetrics = {
    finalValue: 11000,
    totalReturn: 0.1,
    annualizedReturn: 0.2,
    sharpeRatio: 1.5,
    maxDrawdown: -0.15,
    totalTrades: 50,
    winningTrades: 30,
    losingTrades: 20,
    winRate: 0.6,
    profitFactor: 1.8,
    volatility: 0.12
  };

  /** Sets up all mocks for a successful full evaluation flow. */
  const setupHappyPath = (overrides: { score?: number; metrics?: BacktestFinalMetrics } = {}) => {
    const ctx = createService();
    const { strategyConfigRepo, backtestDatasetService, coinResolver, backtestEngine, scoringService } = ctx;

    strategyConfigRepo.findOne.mockResolvedValue(mockStrategy);
    backtestDatasetService.ensureDefaultDatasetExists.mockResolvedValue(mockDataset);
    coinResolver.resolveCoins.mockResolvedValue({ coins: [{ id: 'btc' }] });
    backtestEngine.executeHistoricalBacktest.mockResolvedValue({
      finalMetrics: overrides.metrics ?? mockMetrics,
      trades: []
    });
    scoringService.calculateScore.mockResolvedValue({ overallScore: overrides.score ?? 50 });

    return ctx;
  };

  describe('evaluate()', () => {
    describe('early exit conditions', () => {
      it('should return score=null when strategy not found or missing algorithm', async () => {
        const { service, strategyConfigRepo } = createService();
        strategyConfigRepo.findOne.mockResolvedValue(null);

        const result = await service.evaluate('missing-id');

        expect(result).toEqual(
          expect.objectContaining({
            score: null,
            passed: false,
            reason: expect.stringContaining('not found or missing algorithm')
          })
        );
      });

      it('should return score=null when no eligible user found (creator=null, no fallback)', async () => {
        const { service, strategyConfigRepo, userRepo } = createService();
        strategyConfigRepo.findOne.mockResolvedValue({ ...mockStrategy, creator: null });
        userRepo.findOne.mockResolvedValue(null);

        const result = await service.evaluate('strategy-1');

        expect(result).toEqual(
          expect.objectContaining({
            score: null,
            passed: false,
            reason: expect.stringContaining('No eligible user found')
          })
        );
      });

      it('should return score=null when no dataset available', async () => {
        const { service, strategyConfigRepo, backtestDatasetService } = createService();
        strategyConfigRepo.findOne.mockResolvedValue(mockStrategy);
        backtestDatasetService.ensureDefaultDatasetExists.mockResolvedValue(null);

        const result = await service.evaluate('strategy-1');

        expect(result).toEqual(
          expect.objectContaining({
            score: null,
            passed: false,
            reason: expect.stringContaining('No dataset available')
          })
        );
      });
    });

    describe('coin resolution failures', () => {
      it('should return score=null and mark backtest FAILED when coin resolution throws', async () => {
        const {
          service,
          strategyConfigRepo,
          backtestDatasetService,
          coinResolver,
          backtestRepo,
          backtestResultService
        } = createService();
        strategyConfigRepo.findOne.mockResolvedValue(mockStrategy);
        backtestDatasetService.ensureDefaultDatasetExists.mockResolvedValue(mockDataset);
        coinResolver.resolveCoins.mockRejectedValue(new Error('CCXT timeout'));

        const result = await service.evaluate('strategy-1');

        expect(result).toEqual(
          expect.objectContaining({
            score: null,
            passed: false,
            reason: expect.stringContaining('Coin resolution failed')
          })
        );

        // Verify completedAt was set on save
        const saveCalls = backtestRepo.save.mock.calls;
        const lastSave = saveCalls[saveCalls.length - 1][0];
        expect(lastSave.completedAt).toBeInstanceOf(Date);

        // Verify markFailed was called with error details
        expect(backtestResultService.markFailed).toHaveBeenCalledWith(
          'backtest-1',
          expect.stringContaining('CCXT timeout')
        );
      });

      it('should return score=null and mark backtest FAILED when no coins resolved', async () => {
        const { service, strategyConfigRepo, backtestDatasetService, coinResolver, backtestResultService } =
          createService();
        strategyConfigRepo.findOne.mockResolvedValue(mockStrategy);
        backtestDatasetService.ensureDefaultDatasetExists.mockResolvedValue(mockDataset);
        coinResolver.resolveCoins.mockResolvedValue({ coins: [] });

        const result = await service.evaluate('strategy-1');

        expect(result).toEqual(
          expect.objectContaining({ score: null, passed: false, reason: expect.stringContaining('No coins resolved') })
        );

        expect(backtestResultService.markFailed).toHaveBeenCalledWith('backtest-1', 'No coins resolved from dataset');
      });
    });

    describe('backtest execution', () => {
      it('should re-throw engine errors for BullMQ retry and mark backtest FAILED', async () => {
        const {
          service,
          strategyConfigRepo,
          backtestDatasetService,
          coinResolver,
          backtestEngine,
          backtestResultService
        } = createService();
        strategyConfigRepo.findOne.mockResolvedValue(mockStrategy);
        backtestDatasetService.ensureDefaultDatasetExists.mockResolvedValue(mockDataset);
        coinResolver.resolveCoins.mockResolvedValue({ coins: [{ id: 'btc' }] });
        backtestEngine.executeHistoricalBacktest.mockRejectedValue(new Error('Engine crash'));

        await expect(service.evaluate('strategy-1')).rejects.toThrow('Engine crash');

        // Verify backtest was marked FAILED via backtestResultService before re-throw
        expect(backtestResultService.markFailed).toHaveBeenCalledWith('backtest-1', 'Engine crash');
      });

      it('should set backtest status to RUNNING before executing engine', async () => {
        const { service, backtestRepo, backtestEngine } = setupHappyPath();

        await service.evaluate('strategy-1');

        // Find the save call that set RUNNING status
        const runningSave = backtestRepo.save.mock.calls.find(
          (call: any[]) => call[0].status === BacktestStatus.RUNNING
        );
        expect(runningSave).toBeDefined();
        expect(backtestEngine.executeHistoricalBacktest).toHaveBeenCalled();
      });
    });

    describe('scoring and pass/fail', () => {
      it('should call persistSuccess after successful backtest', async () => {
        const { service, backtestResultService } = setupHappyPath();

        await service.evaluate('strategy-1');

        expect(backtestResultService.persistSuccess).toHaveBeenCalledTimes(1);
      });

      it.each([
        { score: PASS_THRESHOLD, expectedPassed: true, label: 'at threshold' },
        { score: PASS_THRESHOLD + 10, expectedPassed: true, label: 'above threshold' },
        { score: PASS_THRESHOLD - 1, expectedPassed: false, label: 'below threshold' },
        { score: 0, expectedPassed: false, label: 'zero score' }
      ])('should return passed=$expectedPassed when score is $label ($score)', async ({ score, expectedPassed }) => {
        const { service } = setupHappyPath({ score });

        const result = await service.evaluate('strategy-1');

        expect(result.passed).toBe(expectedPassed);
        expect(result.score).toBeDefined();
      });
    });

    describe('resolveUser fallback', () => {
      it('should use creator when available without querying userRepo', async () => {
        const { service, userRepo } = setupHappyPath();

        await service.evaluate('strategy-1');

        expect(userRepo.findOne).not.toHaveBeenCalled();
      });

      it('should fall back to any algo-enabled user when creator is null', async () => {
        const {
          service,
          strategyConfigRepo,
          userRepo,
          backtestDatasetService,
          coinResolver,
          backtestEngine,
          scoringService
        } = createService();
        const fallbackUser = { id: 'fallback-user', algoTradingEnabled: true };

        strategyConfigRepo.findOne.mockResolvedValue({ ...mockStrategy, creator: null });
        userRepo.findOne.mockResolvedValue(fallbackUser);
        backtestDatasetService.ensureDefaultDatasetExists.mockResolvedValue(mockDataset);
        coinResolver.resolveCoins.mockResolvedValue({ coins: [{ id: 'btc' }] });
        backtestEngine.executeHistoricalBacktest.mockResolvedValue({ finalMetrics: mockMetrics, trades: [] });
        scoringService.calculateScore.mockResolvedValue({ overallScore: 50 });

        const result = await service.evaluate('strategy-1');

        expect(userRepo.findOne).toHaveBeenCalledWith({ where: { algoTradingEnabled: true } });
        expect(result.passed).toBe(true);
      });
    });
  });

  describe('createBacktestRun()', () => {
    it('should correctly map BacktestFinalMetrics to BacktestResults', async () => {
      const { service, backtestRunRepo } = setupHappyPath();

      await service.evaluate('strategy-1');

      const createCall = backtestRunRepo.create.mock.calls[0][0];
      const results = createCall.results;

      expect(results).toEqual(
        expect.objectContaining({
          totalReturn: mockMetrics.totalReturn,
          annualizedReturn: mockMetrics.annualizedReturn,
          sharpeRatio: mockMetrics.sharpeRatio,
          maxDrawdown: mockMetrics.maxDrawdown,
          winRate: mockMetrics.winRate,
          profitFactor: mockMetrics.profitFactor,
          totalTrades: mockMetrics.totalTrades,
          volatility: mockMetrics.volatility
        })
      );

      // Derived fields
      expect(results.calmarRatio).toBeCloseTo(mockMetrics.annualizedReturn / Math.abs(mockMetrics.maxDrawdown));
      expect(results.avgTradeReturn).toBeCloseTo(mockMetrics.totalReturn / mockMetrics.totalTrades);
    });

    it.each([
      {
        field: 'maxDrawdown',
        value: 0,
        derived: 'calmarRatio',
        expected: 0,
        label: 'zero maxDrawdown → calmarRatio=0'
      },
      {
        field: 'totalTrades',
        value: 0,
        derived: 'avgTradeReturn',
        expected: 0,
        label: 'zero totalTrades → avgTradeReturn=0'
      }
    ])('should handle $label', async ({ field, value, derived, expected }) => {
      const overrideMetrics = { ...mockMetrics, [field]: value };
      const { service, backtestRunRepo } = setupHappyPath({ metrics: overrideMetrics });

      await service.evaluate('strategy-1');

      const results = backtestRunRepo.create.mock.calls[0][0].results;
      expect(results[derived]).toBe(expected);
    });
  });
});
