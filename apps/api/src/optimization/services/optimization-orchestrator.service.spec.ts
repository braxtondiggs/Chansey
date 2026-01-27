import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';

import { WindowMetrics } from '@chansey/api-interfaces';

import { GridSearchService } from './grid-search.service';
import { OptimizationOrchestratorService } from './optimization-orchestrator.service';

import { Coin } from '../../coin/coin.entity';
import { BacktestEngine } from '../../order/backtest/backtest-engine.service';
import { WalkForwardService } from '../../scoring/walk-forward/walk-forward.service';
import { WindowProcessor } from '../../scoring/walk-forward/window-processor';
import { StrategyConfig } from '../../strategy/entities/strategy-config.entity';
import { OptimizationResult } from '../entities/optimization-result.entity';
import { OptimizationRun, OptimizationStatus } from '../entities/optimization-run.entity';
import { OptimizationConfig, ParameterSpace } from '../interfaces';

type MockRepo<T> = jest.Mocked<Repository<T>>;

// Helper to create a valid OptimizationConfig with all required fields
const createValidConfig = (overrides: Partial<OptimizationConfig> = {}): OptimizationConfig => ({
  method: 'grid_search',
  walkForward: {
    trainDays: 90,
    testDays: 30,
    stepDays: 15,
    method: 'rolling',
    minWindowsRequired: 3,
    ...overrides.walkForward
  },
  objective: {
    metric: 'sharpe_ratio',
    minimize: false,
    ...overrides.objective
  },
  parallelism: {
    maxConcurrentBacktests: 3,
    maxConcurrentWindows: 3,
    ...overrides.parallelism
  },
  ...overrides
});

// Helper to create a valid ParameterSpace
const createValidSpace = (overrides: Partial<ParameterSpace> = {}): ParameterSpace => ({
  strategyType: 'test-strategy',
  parameters: [],
  ...overrides
});

describe('OptimizationOrchestratorService', () => {
  let service: OptimizationOrchestratorService;
  let optimizationRunRepo: MockRepo<OptimizationRun>;
  let optimizationResultRepo: MockRepo<OptimizationResult>;
  let strategyConfigRepo: MockRepo<StrategyConfig>;
  let coinRepo: MockRepo<Coin>;
  let optimizationQueue: jest.Mocked<Queue>;
  let gridSearchService: jest.Mocked<GridSearchService>;
  let walkForwardService: jest.Mocked<WalkForwardService>;
  let windowProcessor: jest.Mocked<WindowProcessor>;
  let backtestEngine: jest.Mocked<BacktestEngine>;
  let dataSource: jest.Mocked<DataSource>;

  beforeEach(() => {
    optimizationRunRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      update: jest.fn()
    } as unknown as MockRepo<OptimizationRun>;

    optimizationResultRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      find: jest.fn(),
      update: jest.fn()
    } as unknown as MockRepo<OptimizationResult>;

    strategyConfigRepo = {
      findOne: jest.fn(),
      save: jest.fn()
    } as unknown as MockRepo<StrategyConfig>;

    coinRepo = {
      createQueryBuilder: jest.fn(),
      find: jest.fn()
    } as unknown as MockRepo<Coin>;

    optimizationQueue = {
      add: jest.fn(),
      remove: jest.fn()
    } as unknown as jest.Mocked<Queue>;

    gridSearchService = {
      generateCombinations: jest.fn(),
      generateRandomCombinations: jest.fn()
    } as unknown as jest.Mocked<GridSearchService>;

    walkForwardService = {
      generateWindows: jest.fn()
    } as unknown as jest.Mocked<WalkForwardService>;

    windowProcessor = {
      processWindow: jest.fn()
    } as unknown as jest.Mocked<WindowProcessor>;

    backtestEngine = {
      executeOptimizationBacktest: jest.fn()
    } as unknown as jest.Mocked<BacktestEngine>;

    dataSource = {
      transaction: jest.fn()
    } as unknown as jest.Mocked<DataSource>;

    const eventEmitter = {
      emit: jest.fn()
    } as unknown as jest.Mocked<EventEmitter2>;

    service = new OptimizationOrchestratorService(
      optimizationRunRepo,
      optimizationResultRepo,
      strategyConfigRepo,
      coinRepo,
      optimizationQueue,
      gridSearchService,
      walkForwardService,
      windowProcessor,
      backtestEngine,
      dataSource,
      eventEmitter
    );
  });

  describe('validateOptimizationConfig', () => {
    it('should pass for valid configuration', async () => {
      const config = createValidConfig();

      strategyConfigRepo.findOne.mockResolvedValue({ id: 'strategy-1' } as StrategyConfig);
      gridSearchService.generateCombinations.mockReturnValue([{ index: 0, values: {}, isBaseline: true }]);
      optimizationRunRepo.create.mockReturnValue({} as OptimizationRun);
      optimizationRunRepo.save.mockResolvedValue({ id: 'run-1' } as OptimizationRun);

      await expect(service.startOptimization('strategy-1', createValidSpace(), config)).resolves.toBeDefined();
    });

    it('should reject when trainDays < testDays', async () => {
      const config = createValidConfig({
        walkForward: {
          trainDays: 30,
          testDays: 90, // Invalid: test > train
          stepDays: 15,
          method: 'rolling',
          minWindowsRequired: 3
        }
      });

      await expect(service.startOptimization('strategy-1', createValidSpace(), config)).rejects.toThrow(
        BadRequestException
      );
    });

    it('should reject when trainDays is not positive', async () => {
      const config = createValidConfig({
        walkForward: {
          trainDays: 0,
          testDays: 30,
          stepDays: 15,
          method: 'rolling',
          minWindowsRequired: 3
        }
      });

      await expect(service.startOptimization('strategy-1', createValidSpace(), config)).rejects.toThrow(
        BadRequestException
      );
    });

    it('should reject when testDays is not positive', async () => {
      const config = createValidConfig({
        walkForward: {
          trainDays: 90,
          testDays: 0,
          stepDays: 15,
          method: 'rolling',
          minWindowsRequired: 3
        }
      });

      await expect(service.startOptimization('strategy-1', createValidSpace(), config)).rejects.toThrow(
        BadRequestException
      );
    });

    it('should reject when stepDays is not positive', async () => {
      const config = createValidConfig({
        walkForward: {
          trainDays: 90,
          testDays: 30,
          stepDays: 0,
          method: 'rolling',
          minWindowsRequired: 3
        }
      });

      await expect(service.startOptimization('strategy-1', createValidSpace(), config)).rejects.toThrow(
        BadRequestException
      );
    });

    it('should reject when maxCombinations is not positive', async () => {
      const config = createValidConfig({
        maxCombinations: 0
      });

      await expect(service.startOptimization('strategy-1', createValidSpace(), config)).rejects.toThrow(
        BadRequestException
      );
    });

    it('should reject when maxIterations is not positive', async () => {
      const config = createValidConfig({
        method: 'random_search',
        maxIterations: 0
      });

      await expect(service.startOptimization('strategy-1', createValidSpace(), config)).rejects.toThrow(
        BadRequestException
      );
    });

    it('should reject when early stop patience is not positive', async () => {
      const config = createValidConfig({
        earlyStop: {
          enabled: true,
          patience: 0,
          minImprovement: 1
        }
      });

      await expect(service.startOptimization('strategy-1', createValidSpace(), config)).rejects.toThrow(
        BadRequestException
      );
    });

    it('should reject when early stop minImprovement is negative', async () => {
      const config = createValidConfig({
        earlyStop: {
          enabled: true,
          patience: 3,
          minImprovement: -0.01
        }
      });

      await expect(service.startOptimization('strategy-1', createValidSpace(), config)).rejects.toThrow(
        BadRequestException
      );
    });

    it('should reject when composite weights do not sum to 1.0', async () => {
      const config = createValidConfig({
        objective: {
          metric: 'composite',
          minimize: false,
          weights: {
            sharpeRatio: 0.5,
            totalReturn: 0.3
            // Sum = 0.8, not 1.0
          }
        }
      });

      await expect(service.startOptimization('strategy-1', createValidSpace(), config)).rejects.toThrow(
        BadRequestException
      );
    });

    it('should pass when composite weights sum to 1.0', async () => {
      const config = createValidConfig({
        objective: {
          metric: 'composite',
          minimize: false,
          weights: {
            sharpeRatio: 0.5,
            totalReturn: 0.5
          }
        }
      });

      strategyConfigRepo.findOne.mockResolvedValue({ id: 'strategy-1' } as StrategyConfig);
      gridSearchService.generateCombinations.mockReturnValue([{ index: 0, values: {}, isBaseline: true }]);
      optimizationRunRepo.create.mockReturnValue({} as OptimizationRun);
      optimizationRunRepo.save.mockResolvedValue({ id: 'run-1' } as OptimizationRun);

      await expect(service.startOptimization('strategy-1', createValidSpace(), config)).resolves.toBeDefined();
    });

    it('should reject when startDate >= endDate', async () => {
      const config = createValidConfig({
        dateRange: {
          startDate: new Date('2024-01-01'),
          endDate: new Date('2023-01-01') // Before start
        }
      });

      await expect(service.startOptimization('strategy-1', createValidSpace(), config)).rejects.toThrow(
        BadRequestException
      );
    });
  });

  describe('calculateObjectiveScore', () => {
    // Access private method via service as any
    const calculateScore = (metrics: WindowMetrics, metric: string, weights?: any) => {
      return (service as any).calculateObjectiveScore(metrics, { metric, weights });
    };

    const baseMetrics: WindowMetrics = {
      sharpeRatio: 1.5,
      totalReturn: 0.25,
      maxDrawdown: -0.15,
      winRate: 0.6,
      tradeCount: 100,
      profitFactor: 2.0,
      volatility: 0.2,
      downsideDeviation: 0.15
    };

    it('should return sharpe ratio for sharpe_ratio metric', () => {
      const score = calculateScore(baseMetrics, 'sharpe_ratio');
      expect(score).toBe(1.5);
    });

    it('should return total return for total_return metric', () => {
      const score = calculateScore(baseMetrics, 'total_return');
      expect(score).toBe(0.25);
    });

    it('should calculate calmar ratio correctly', () => {
      const score = calculateScore(baseMetrics, 'calmar_ratio');
      // 0.25 / abs(-0.15) = 0.25 / 0.15 = 1.667
      expect(score).toBeCloseTo(1.667, 2);
    });

    it('should return 0 for calmar ratio when maxDrawdown is 0', () => {
      const metrics = { ...baseMetrics, maxDrawdown: 0 };
      const score = calculateScore(metrics, 'calmar_ratio');
      expect(score).toBe(0);
    });

    it('should return profit factor for profit_factor metric', () => {
      const score = calculateScore(baseMetrics, 'profit_factor');
      expect(score).toBe(2.0);
    });

    it('should default profit factor to 1 when missing', () => {
      const metrics = { ...baseMetrics, profitFactor: undefined as unknown as number };
      const score = calculateScore(metrics, 'profit_factor');
      expect(score).toBe(1);
    });

    it('should calculate sortino ratio using downside deviation', () => {
      const score = calculateScore(baseMetrics, 'sortino_ratio');
      // (0.25 - 0.02) / 0.15 = 0.23 / 0.15 = 1.533
      expect(score).toBeCloseTo(1.533, 2);
    });

    it('should fallback to sharpe when downsideDeviation is 0', () => {
      const metrics = { ...baseMetrics, downsideDeviation: 0 };
      const score = calculateScore(metrics, 'sortino_ratio');
      expect(score).toBe(1.5); // Sharpe ratio fallback
    });

    it('should fallback to sharpe when downsideDeviation is undefined', () => {
      const metrics = { ...baseMetrics };
      delete metrics.downsideDeviation;
      const score = calculateScore(metrics, 'sortino_ratio');
      expect(score).toBe(1.5); // Sharpe ratio fallback
    });

    it('should default to sharpe ratio for unknown metric', () => {
      const score = calculateScore(baseMetrics, 'unknown_metric');
      expect(score).toBe(1.5);
    });
  });

  describe('calculateConsistencyScore', () => {
    const calculateConsistency = (scores: number[]) => {
      return (service as any).calculateConsistencyScore(scores);
    };

    it('should return 100 for single score', () => {
      expect(calculateConsistency([1.5])).toBe(100);
    });

    it('should return 100 for identical scores (zero variance)', () => {
      expect(calculateConsistency([1.5, 1.5, 1.5, 1.5])).toBe(100);
    });

    it('should return lower score for high variance', () => {
      const lowVarianceScore = calculateConsistency([1.0, 1.1, 1.0, 1.1]);
      const highVarianceScore = calculateConsistency([0.5, 2.0, 0.5, 2.0]);

      expect(lowVarianceScore).toBeGreaterThan(highVarianceScore);
    });

    it('should return 0 for very high variance (stdDev >= 2)', () => {
      const score = calculateConsistency([-5, 5, -5, 5]); // Very high std dev
      expect(score).toBe(0);
    });

    it('should return 50 for stdDev of 1', () => {
      const score = calculateConsistency([-1, 1]); // stdDev=1 -> 100 - 50 = 50
      expect(score).toBe(50);
    });

    it('should round to 2 decimal places', () => {
      const score = calculateConsistency([1.0, 1.5, 1.25]);
      expect(score).toBe(Math.round(score * 100) / 100);
    });
  });

  describe('startOptimization', () => {
    it('should throw NotFoundException for non-existent strategy', async () => {
      strategyConfigRepo.findOne.mockResolvedValue(null);

      await expect(service.startOptimization('non-existent', createValidSpace(), createValidConfig())).rejects.toThrow(
        NotFoundException
      );
    });

    it('should create optimization run and queue job', async () => {
      const config = createValidConfig();
      const strategyConfig = { id: 'strategy-1', algorithmId: 'algo-1' } as StrategyConfig;

      strategyConfigRepo.findOne.mockResolvedValue(strategyConfig);
      gridSearchService.generateCombinations.mockReturnValue([
        { index: 0, values: { period: 14 }, isBaseline: true },
        { index: 1, values: { period: 20 }, isBaseline: false }
      ]);
      optimizationRunRepo.create.mockReturnValue({ id: 'run-1' } as OptimizationRun);
      optimizationRunRepo.save.mockResolvedValue({ id: 'run-1' } as OptimizationRun);

      const result = await service.startOptimization('strategy-1', createValidSpace(), config);

      expect(result.id).toBe('run-1');
      expect(optimizationQueue.add).toHaveBeenCalledWith(
        'run-optimization',
        expect.objectContaining({
          runId: 'run-1',
          combinations: expect.any(Array)
        }),
        expect.any(Object)
      );
    });

    it('should fallback to parameter space defaults when no baseline combination', async () => {
      const config = createValidConfig();
      const space = createValidSpace({
        parameters: [{ name: 'period', type: 'integer', min: 10, max: 20, step: 5, default: 15, priority: 'medium' }]
      });

      strategyConfigRepo.findOne.mockResolvedValue({ id: 'strategy-1' } as StrategyConfig);
      gridSearchService.generateCombinations.mockReturnValue([{ index: 0, values: { period: 10 }, isBaseline: false }]);
      optimizationRunRepo.create.mockReturnValue({} as OptimizationRun);
      optimizationRunRepo.save.mockResolvedValue({ id: 'run-1' } as OptimizationRun);

      await service.startOptimization('strategy-1', space, config);

      expect(optimizationRunRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baselineParameters: { period: 15 }
        })
      );
    });

    it('should use random_search method when specified', async () => {
      const config = createValidConfig({ method: 'random_search', maxIterations: 50 });
      const strategyConfig = { id: 'strategy-1' } as StrategyConfig;

      strategyConfigRepo.findOne.mockResolvedValue(strategyConfig);
      gridSearchService.generateRandomCombinations.mockReturnValue([{ index: 0, values: {}, isBaseline: true }]);
      optimizationRunRepo.create.mockReturnValue({} as OptimizationRun);
      optimizationRunRepo.save.mockResolvedValue({ id: 'run-1' } as OptimizationRun);

      await service.startOptimization('strategy-1', createValidSpace(), config);

      expect(gridSearchService.generateRandomCombinations).toHaveBeenCalledWith(expect.any(Object), 50);
    });
  });

  describe('executeOptimization', () => {
    const buildRun = (overrides: Partial<OptimizationRun> = {}) =>
      ({
        id: 'run-1',
        status: OptimizationStatus.PENDING,
        strategyConfigId: 'strategy-1',
        strategyConfig: { id: 'strategy-1', algorithmId: 'algo-1' } as StrategyConfig,
        config: createValidConfig(),
        parameterSpace: createValidSpace(),
        baselineParameters: { period: 14 },
        totalCombinations: 2,
        combinationsTested: 0,
        ...overrides
      }) as OptimizationRun;

    const mockCoins = [{ id: 'btc' }, { id: 'eth' }] as Coin[];

    const mockCoinQueryBuilder = () => ({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(mockCoins)
    });

    it('should throw NotFoundException when run is missing', async () => {
      optimizationRunRepo.findOne.mockResolvedValue(null);

      await expect(service.executeOptimization('missing', [])).rejects.toThrow(NotFoundException);
    });

    it('should mark run failed when insufficient windows are generated', async () => {
      const run = buildRun({
        config: createValidConfig({ walkForward: { minWindowsRequired: 3 } as any })
      });
      optimizationRunRepo.findOne.mockResolvedValue(run);
      optimizationRunRepo.save.mockResolvedValue(run);
      coinRepo.createQueryBuilder.mockReturnValue(mockCoinQueryBuilder() as any);
      walkForwardService.generateWindows.mockReturnValue([]);

      await expect(service.executeOptimization(run.id, [])).rejects.toThrow('Insufficient windows');

      expect(run.status).toBe(OptimizationStatus.FAILED);
      expect(run.errorMessage).toContain('Insufficient windows');
      expect(optimizationRunRepo.save).toHaveBeenCalledWith(run);
    });

    it('should exit early when run is cancelled before processing batch', async () => {
      const run = buildRun({
        config: createValidConfig({ walkForward: { minWindowsRequired: 1 } as any })
      });
      optimizationRunRepo.findOne
        .mockResolvedValueOnce(run) // initial load with relations
        .mockResolvedValueOnce({ id: run.id, status: OptimizationStatus.CANCELLED } as OptimizationRun); // cancellation check

      optimizationRunRepo.save.mockResolvedValue(run);
      coinRepo.createQueryBuilder.mockReturnValue(mockCoinQueryBuilder() as any);
      walkForwardService.generateWindows.mockReturnValue([
        {
          windowIndex: 0,
          trainStartDate: new Date('2024-01-01'),
          trainEndDate: new Date('2024-02-01'),
          testStartDate: new Date('2024-02-01'),
          testEndDate: new Date('2024-03-01')
        }
      ]);

      const evaluateSpy = jest.spyOn(service, 'evaluateCombination');

      await service.executeOptimization(run.id, [{ index: 0, values: {}, isBaseline: true }]);

      expect(evaluateSpy).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('cancelOptimization', () => {
    it('should cancel running optimization', async () => {
      const run = { id: 'run-1', status: OptimizationStatus.RUNNING } as OptimizationRun;
      optimizationRunRepo.findOne.mockResolvedValue(run);
      optimizationRunRepo.save.mockResolvedValue(run);

      await service.cancelOptimization('run-1');

      expect(run.status).toBe(OptimizationStatus.CANCELLED);
      expect(optimizationQueue.remove).toHaveBeenCalledWith('run-1');
    });

    it('should throw NotFoundException for non-existent run', async () => {
      optimizationRunRepo.findOne.mockResolvedValue(null);

      await expect(service.cancelOptimization('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should throw error when trying to cancel completed run', async () => {
      const run = { id: 'run-1', status: OptimizationStatus.COMPLETED } as OptimizationRun;
      optimizationRunRepo.findOne.mockResolvedValue(run);

      await expect(service.cancelOptimization('run-1')).rejects.toThrow('Cannot cancel optimization');
    });
  });

  describe('getProgress', () => {
    it('should return progress for running optimization', async () => {
      const run = {
        id: 'run-1',
        status: OptimizationStatus.RUNNING,
        combinationsTested: 50,
        totalCombinations: 100,
        progressDetails: {
          estimatedTimeRemaining: 300,
          currentBestScore: 1.5
        }
      } as OptimizationRun;
      optimizationRunRepo.findOne.mockResolvedValue(run);

      const progress = await service.getProgress('run-1');

      expect(progress.percentComplete).toBe(50);
      expect(progress.currentBestScore).toBe(1.5);
      expect(progress.estimatedTimeRemaining).toBe(300);
    });

    it('should return 0 percent when totalCombinations is 0', async () => {
      const run = {
        id: 'run-1',
        status: OptimizationStatus.RUNNING,
        combinationsTested: 0,
        totalCombinations: 0
      } as OptimizationRun;
      optimizationRunRepo.findOne.mockResolvedValue(run);

      const progress = await service.getProgress('run-1');

      expect(progress.percentComplete).toBe(0);
      expect(progress.estimatedTimeRemaining).toBe(0);
    });

    it('should throw NotFoundException for non-existent run', async () => {
      optimizationRunRepo.findOne.mockResolvedValue(null);

      await expect(service.getProgress('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getResults', () => {
    it('should return results sorted by test score', async () => {
      const results = [{ avgTestScore: 1.5 }, { avgTestScore: 2.0 }, { avgTestScore: 1.0 }] as OptimizationResult[];
      optimizationResultRepo.find.mockResolvedValue(results);

      const fetched = await service.getResults('run-1', 20, 'testScore');

      expect(optimizationResultRepo.find).toHaveBeenCalledWith({
        where: { optimizationRunId: 'run-1' },
        order: { avgTestScore: 'DESC' },
        take: 20
      });
    });

    it('should sort by degradation ascending', async () => {
      await service.getResults('run-1', 20, 'degradation');

      expect(optimizationResultRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { avgDegradation: 'ASC' }
        })
      );
    });

    it('should sort by consistency descending', async () => {
      await service.getResults('run-1', 10, 'consistency');

      expect(optimizationResultRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { consistencyScore: 'DESC' },
          take: 10
        })
      );
    });
  });

  describe('applyBestParameters', () => {
    it('should apply best parameters to strategy', async () => {
      const strategyConfig = {
        id: 'strategy-1',
        parameters: { existing: true }
      } as unknown as StrategyConfig;
      const run = {
        id: 'run-1',
        status: OptimizationStatus.COMPLETED,
        bestParameters: { period: 20, threshold: 0.3 },
        strategyConfig
      } as unknown as OptimizationRun;

      optimizationRunRepo.findOne.mockResolvedValue(run);
      strategyConfigRepo.save.mockResolvedValue(strategyConfig);

      const result = await service.applyBestParameters('run-1');

      expect(result.parameters).toEqual({
        existing: true,
        period: 20,
        threshold: 0.3
      });
    });

    it('should throw NotFoundException when run does not exist', async () => {
      optimizationRunRepo.findOne.mockResolvedValue(null);

      await expect(service.applyBestParameters('missing')).rejects.toThrow(NotFoundException);
    });

    it('should throw error for incomplete optimization', async () => {
      const run = {
        id: 'run-1',
        status: OptimizationStatus.RUNNING
      } as OptimizationRun;
      optimizationRunRepo.findOne.mockResolvedValue(run);

      await expect(service.applyBestParameters('run-1')).rejects.toThrow(
        'Cannot apply parameters from incomplete optimization run'
      );
    });

    it('should throw error when no best parameters found', async () => {
      const run = {
        id: 'run-1',
        status: OptimizationStatus.COMPLETED,
        bestParameters: null
      } as OptimizationRun;
      optimizationRunRepo.findOne.mockResolvedValue(run);

      await expect(service.applyBestParameters('run-1')).rejects.toThrow('No best parameters found');
    });
  });
});
