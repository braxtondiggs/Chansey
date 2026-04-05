import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { Queue } from 'bullmq';
import { DataSource, ObjectLiteral, Repository } from 'typeorm';

import { GridSearchService } from './grid-search.service';
import { OptimizationEvaluationService } from './optimization-evaluation.service';
import { OptimizationOrchestratorService } from './optimization-orchestrator.service';
import { OptimizationQueryService } from './optimization-query.service';

import { StrategyConfig } from '../../strategy/entities/strategy-config.entity';
import { OptimizationResult } from '../entities/optimization-result.entity';
import { OptimizationRun, OptimizationStatus } from '../entities/optimization-run.entity';
import { OptimizationConfig, ParameterSpace } from '../interfaces';

type MockRepo<T extends ObjectLiteral> = jest.Mocked<Repository<T>>;

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
  let optimizationQueue: jest.Mocked<Queue>;
  let gridSearchService: jest.Mocked<GridSearchService>;
  let evaluationService: jest.Mocked<OptimizationEvaluationService>;
  let queryService: jest.Mocked<OptimizationQueryService>;
  let dataSource: jest.Mocked<DataSource>;
  let eventEmitter: jest.Mocked<EventEmitter2>;

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
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 })
      })
    } as unknown as MockRepo<OptimizationResult>;

    optimizationQueue = {
      add: jest.fn(),
      remove: jest.fn()
    } as unknown as jest.Mocked<Queue>;

    gridSearchService = {
      generateCombinations: jest.fn(),
      generateRandomCombinations: jest.fn()
    } as unknown as jest.Mocked<GridSearchService>;

    evaluationService = {
      evaluateCombination: jest.fn(),
      loadCoinsForOptimization: jest.fn().mockResolvedValue([{ id: 'btc' }, { id: 'eth' }]),
      loadAndIndexCandles: jest.fn().mockResolvedValue({ candlesByCoin: new Map(), allCandleCount: 0 }),
      precomputeAllWindowData: jest.fn().mockReturnValue(new Map()),
      prepareWalkForwardData: jest.fn().mockResolvedValue({
        windows: [
          {
            windowIndex: 0,
            trainStartDate: new Date('2024-01-01'),
            trainEndDate: new Date('2024-04-01'),
            testStartDate: new Date('2024-04-01'),
            testEndDate: new Date('2024-05-01')
          }
        ],
        candlesByCoin: new Map(),
        precomputedWindows: new Map(),
        warmupDays: 14
      }),
      getDateRange: jest.fn().mockResolvedValue({
        startDate: new Date('2025-11-10'),
        endDate: new Date('2026-02-20')
      })
    } as unknown as jest.Mocked<OptimizationEvaluationService>;

    queryService = {
      findStrategyConfig: jest.fn(),
      rankResults: jest.fn().mockResolvedValue(null)
    } as unknown as jest.Mocked<OptimizationQueryService>;

    dataSource = {
      transaction: jest.fn()
    } as unknown as jest.Mocked<DataSource>;

    eventEmitter = {
      emit: jest.fn()
    } as unknown as jest.Mocked<EventEmitter2>;

    service = new OptimizationOrchestratorService(
      optimizationRunRepo,
      optimizationResultRepo,
      optimizationQueue,
      gridSearchService,
      evaluationService,
      queryService,
      dataSource,
      eventEmitter
    );
  });

  describe('validateOptimizationConfig', () => {
    it('should pass for valid configuration', async () => {
      const config = createValidConfig();

      queryService.findStrategyConfig.mockResolvedValue({ id: 'strategy-1' } as StrategyConfig);
      gridSearchService.generateCombinations.mockReturnValue([{ index: 0, values: {}, isBaseline: true }]);
      optimizationRunRepo.create.mockReturnValue({} as OptimizationRun);
      optimizationRunRepo.save.mockResolvedValue({ id: 'run-1' } as OptimizationRun);

      const result = await service.startOptimization('strategy-1', createValidSpace(), config);
      expect(result.id).toBe('run-1');
    });

    it.each([
      {
        name: 'trainDays < testDays',
        override: {
          walkForward: { trainDays: 30, testDays: 90, stepDays: 15, method: 'rolling', minWindowsRequired: 3 }
        },
        expectedMessage: 'trainDays must be >= testDays'
      },
      {
        name: 'trainDays not positive',
        override: {
          walkForward: { trainDays: 0, testDays: 30, stepDays: 15, method: 'rolling', minWindowsRequired: 3 }
        },
        expectedMessage: 'trainDays must be positive'
      },
      {
        name: 'testDays not positive',
        override: {
          walkForward: { trainDays: 90, testDays: 0, stepDays: 15, method: 'rolling', minWindowsRequired: 3 }
        },
        expectedMessage: 'testDays must be positive'
      },
      {
        name: 'stepDays not positive',
        override: {
          walkForward: { trainDays: 90, testDays: 30, stepDays: 0, method: 'rolling', minWindowsRequired: 3 }
        },
        expectedMessage: 'stepDays must be positive'
      },
      {
        name: 'maxCombinations not positive',
        override: { maxCombinations: 0 },
        expectedMessage: 'maxCombinations must be positive'
      },
      {
        name: 'maxIterations not positive',
        override: { method: 'random_search', maxIterations: 0 },
        expectedMessage: 'maxIterations must be positive'
      },
      {
        name: 'early stop patience not positive',
        override: { earlyStop: { enabled: true, patience: 0, minImprovement: 1 } },
        expectedMessage: 'patience must be positive'
      },
      {
        name: 'early stop minImprovement negative',
        override: { earlyStop: { enabled: true, patience: 3, minImprovement: -0.01 } },
        expectedMessage: 'minImprovement cannot be negative'
      },
      {
        name: 'composite weights do not sum to 1.0',
        override: {
          objective: { metric: 'composite', minimize: false, weights: { sharpeRatio: 0.5, totalReturn: 0.3 } }
        },
        expectedMessage: 'Composite weights must sum to 1.0'
      },
      {
        name: 'startDate >= endDate',
        override: { dateRange: { startDate: new Date('2024-01-01'), endDate: new Date('2023-01-01') } },
        expectedMessage: 'startDate must be before endDate'
      }
    ])('should reject when $name', async ({ override, expectedMessage }) => {
      const config = createValidConfig(override as Partial<OptimizationConfig>);

      await expect(service.startOptimization('strategy-1', createValidSpace(), config)).rejects.toThrow(
        BadRequestException
      );
      await expect(service.startOptimization('strategy-1', createValidSpace(), config)).rejects.toThrow(
        expectedMessage
      );
    });

    it('should pass when composite weights sum to 1.0', async () => {
      const config = createValidConfig({
        objective: {
          metric: 'composite',
          minimize: false,
          weights: { sharpeRatio: 0.5, totalReturn: 0.5 }
        }
      });

      queryService.findStrategyConfig.mockResolvedValue({ id: 'strategy-1' } as StrategyConfig);
      gridSearchService.generateCombinations.mockReturnValue([{ index: 0, values: {}, isBaseline: true }]);
      optimizationRunRepo.create.mockReturnValue({} as OptimizationRun);
      optimizationRunRepo.save.mockResolvedValue({ id: 'run-1' } as OptimizationRun);

      const result = await service.startOptimization('strategy-1', createValidSpace(), config);
      expect(result.id).toBe('run-1');
    });
  });

  describe('startOptimization', () => {
    it('should throw NotFoundException for non-existent strategy', async () => {
      queryService.findStrategyConfig.mockResolvedValue(null);

      await expect(service.startOptimization('non-existent', createValidSpace(), createValidConfig())).rejects.toThrow(
        NotFoundException
      );
    });

    it('should create optimization run and queue job', async () => {
      const config = createValidConfig();
      const strategyConfig = { id: 'strategy-1', algorithmId: 'algo-1' } as StrategyConfig;

      queryService.findStrategyConfig.mockResolvedValue(strategyConfig);
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
        expect.objectContaining({ jobId: 'run-1', removeOnComplete: true, attempts: 1 })
      );
    });

    it('should fallback to parameter space defaults when no baseline combination', async () => {
      const config = createValidConfig();
      const space = createValidSpace({
        parameters: [{ name: 'period', type: 'integer', min: 10, max: 20, step: 5, default: 15, priority: 'medium' }]
      });

      queryService.findStrategyConfig.mockResolvedValue({ id: 'strategy-1' } as StrategyConfig);
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

      queryService.findStrategyConfig.mockResolvedValue(strategyConfig);
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

    it('should throw NotFoundException when run is missing', async () => {
      optimizationRunRepo.findOne.mockResolvedValue(null);

      await expect(service.executeOptimization('missing', [])).rejects.toThrow(NotFoundException);
    });

    it('should mark run failed and emit event when error occurs', async () => {
      const run = buildRun({
        config: createValidConfig({ walkForward: { minWindowsRequired: 3 } as any })
      });
      optimizationRunRepo.findOne.mockResolvedValue(run);
      optimizationRunRepo.save.mockResolvedValue(run);
      evaluationService.prepareWalkForwardData.mockRejectedValue(new Error('Insufficient windows: 0 generated'));

      await expect(service.executeOptimization(run.id, [])).rejects.toThrow('Insufficient windows');

      expect(run.status).toBe(OptimizationStatus.FAILED);
      expect(run.errorMessage).toContain('Insufficient windows');
      expect(run.completedAt).toBeInstanceOf(Date);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        expect.stringContaining('optimization.failed'),
        expect.objectContaining({ runId: run.id, reason: expect.stringContaining('Insufficient windows') })
      );
    });

    it('should preserve startedAt on resume', async () => {
      const originalStartedAt = new Date('2025-01-01T00:00:00Z');
      const run = buildRun({
        combinationsTested: 5,
        startedAt: originalStartedAt,
        config: createValidConfig({ walkForward: { minWindowsRequired: 1 } as any })
      });
      optimizationRunRepo.findOne.mockResolvedValue(run);
      optimizationRunRepo.save.mockImplementation(async (r: any) => r);
      optimizationRunRepo.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      optimizationResultRepo.find.mockResolvedValue([
        { combinationIndex: 0, avgTestScore: 1.5, parameters: { period: 14 }, isBaseline: true } as any
      ]);

      await service.executeOptimization(run.id, [{ index: 0, values: { period: 14 }, isBaseline: true }]);

      expect(run.startedAt).toEqual(originalStartedAt);
    });

    it('should skip already-processed combinations on resume', async () => {
      const run = buildRun({
        combinationsTested: 1,
        startedAt: new Date('2025-01-01T00:00:00Z'),
        config: createValidConfig({ walkForward: { minWindowsRequired: 1 } as any })
      });
      optimizationRunRepo.findOne
        .mockResolvedValueOnce(run) // initial load
        .mockResolvedValueOnce(run); // cancellation check
      optimizationRunRepo.save.mockImplementation(async (r: any) => r);
      optimizationRunRepo.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      optimizationResultRepo.find.mockResolvedValue([
        { combinationIndex: 0, avgTestScore: 1.5, parameters: { period: 14 }, isBaseline: true } as any
      ]);

      evaluationService.evaluateCombination.mockResolvedValue({
        avgTrainScore: 2.0,
        avgTestScore: 2.0,
        avgDegradation: 0.05,
        consistencyScore: 90,
        overfittingWindows: 0,
        windowResults: []
      });

      const managerSave = jest.fn().mockResolvedValue({});
      const managerCreate = jest.fn().mockReturnValue({});
      dataSource.transaction.mockImplementation(async (cb: any) => {
        await cb({ save: managerSave, create: managerCreate });
      });

      await service.executeOptimization(run.id, [
        { index: 0, values: { period: 14 }, isBaseline: true },
        { index: 1, values: { period: 20 }, isBaseline: false }
      ]);

      expect(evaluationService.evaluateCombination).toHaveBeenCalledTimes(1);
    });

    it('should reconstruct bestScore and baselineScore from existing results on resume', async () => {
      const run = buildRun({
        combinationsTested: 2,
        startedAt: new Date('2025-01-01T00:00:00Z'),
        config: createValidConfig({ walkForward: { minWindowsRequired: 1 } as any })
      });
      optimizationRunRepo.findOne.mockResolvedValue(run);
      optimizationRunRepo.save.mockImplementation(async (r: any) => r);
      optimizationRunRepo.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      optimizationResultRepo.find.mockResolvedValue([
        { combinationIndex: 0, avgTestScore: 1.2, parameters: { period: 14 }, isBaseline: true } as any,
        { combinationIndex: 1, avgTestScore: 1.8, parameters: { period: 20 }, isBaseline: false } as any
      ]);

      await service.executeOptimization(run.id, [
        { index: 0, values: { period: 14 }, isBaseline: true },
        { index: 1, values: { period: 20 }, isBaseline: false }
      ]);

      expect(run.status).toBe(OptimizationStatus.COMPLETED);
      expect(run.bestScore).toBeDefined();
    });

    it('should exit early when run is cancelled before processing batch', async () => {
      const run = buildRun({
        config: createValidConfig({ walkForward: { minWindowsRequired: 1 } as any })
      });
      optimizationRunRepo.findOne
        .mockResolvedValueOnce(run)
        .mockResolvedValueOnce({ id: run.id, status: OptimizationStatus.CANCELLED } as OptimizationRun);

      optimizationRunRepo.save.mockResolvedValue(run);

      await service.executeOptimization(run.id, [{ index: 0, values: {}, isBaseline: true }]);

      expect(evaluationService.evaluateCombination).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('should complete a full run with finalization and event emission', async () => {
      const run = buildRun({
        config: createValidConfig({ walkForward: { minWindowsRequired: 1 } as any })
      });
      optimizationRunRepo.findOne
        .mockResolvedValueOnce(run) // initial load
        .mockResolvedValueOnce(run); // cancellation check
      optimizationRunRepo.save.mockImplementation(async (r: any) => r);
      optimizationRunRepo.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      evaluationService.evaluateCombination.mockResolvedValue({
        avgTrainScore: 1.5,
        avgTestScore: 1.2,
        avgDegradation: 0.1,
        consistencyScore: 85,
        overfittingWindows: 0,
        windowResults: []
      });

      const managerSave = jest.fn().mockResolvedValue({});
      const managerCreate = jest.fn().mockReturnValue({});
      dataSource.transaction.mockImplementation(async (cb: any) => {
        await cb({ save: managerSave, create: managerCreate });
      });

      queryService.rankResults.mockResolvedValue({
        id: 'result-1',
        avgTestScore: 1.2,
        parameters: { period: 14 }
      } as any);

      await service.executeOptimization(run.id, [{ index: 0, values: { period: 14 }, isBaseline: true }]);

      expect(run.status).toBe(OptimizationStatus.COMPLETED);
      expect(run.completedAt).toBeInstanceOf(Date);
      expect(run.bestScore).toBe(1.2);
      expect(run.bestParameters).toEqual({ period: 14 });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        expect.stringContaining('optimization.completed'),
        expect.objectContaining({
          runId: run.id,
          strategyConfigId: run.strategyConfigId,
          bestParameters: { period: 14 },
          bestScore: 1.2
        })
      );
    });

    it('should trigger early stopping when patience is exhausted', async () => {
      const run = buildRun({
        config: createValidConfig({
          walkForward: { minWindowsRequired: 1 } as any,
          earlyStop: { enabled: true, patience: 2, minImprovement: 50 },
          parallelism: { maxConcurrentBacktests: 1, maxConcurrentWindows: 1 }
        }),
        totalCombinations: 3
      });
      optimizationRunRepo.findOne
        .mockResolvedValueOnce(run) // initial load
        .mockResolvedValueOnce(run) // cancellation check batch 1
        .mockResolvedValueOnce(run) // cancellation check batch 2
        .mockResolvedValueOnce(run); // cancellation check batch 3
      optimizationRunRepo.save.mockImplementation(async (r: any) => r);
      optimizationRunRepo.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      // Baseline sets bestScore; subsequent combos produce no improvement
      evaluationService.evaluateCombination
        .mockResolvedValueOnce({
          avgTrainScore: 1.0,
          avgTestScore: 1.0,
          avgDegradation: 0.1,
          consistencyScore: 80,
          overfittingWindows: 0,
          windowResults: []
        })
        .mockResolvedValueOnce({
          avgTrainScore: 1.0,
          avgTestScore: 0.9,
          avgDegradation: 0.1,
          consistencyScore: 80,
          overfittingWindows: 0,
          windowResults: []
        })
        .mockResolvedValueOnce({
          avgTrainScore: 1.0,
          avgTestScore: 0.8,
          avgDegradation: 0.1,
          consistencyScore: 80,
          overfittingWindows: 0,
          windowResults: []
        });

      const managerSave = jest.fn().mockResolvedValue({});
      const managerCreate = jest.fn().mockReturnValue({});
      dataSource.transaction.mockImplementation(async (cb: any) => {
        await cb({ save: managerSave, create: managerCreate });
      });

      await service.executeOptimization(run.id, [
        { index: 0, values: { period: 14 }, isBaseline: true },
        { index: 1, values: { period: 20 }, isBaseline: false },
        { index: 2, values: { period: 26 }, isBaseline: false }
      ]);

      // With patience=2 and maxConcurrent=1: combo 1 (baseline) resets counter,
      // combos 2 & 3 each miss minImprovement → counter reaches patience and stops.
      expect(evaluationService.evaluateCombination).toHaveBeenCalledTimes(3);
      expect(run.status).toBe(OptimizationStatus.COMPLETED);
    });
  });

  describe('updateProgress', () => {
    it('should preserve autoResumeCount in progress details', async () => {
      const run = {
        id: 'run-1',
        startedAt: new Date(Date.now() - 60000),
        totalCombinations: 10,
        progressDetails: { autoResumeCount: 2 }
      } as unknown as OptimizationRun;

      optimizationRunRepo.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      await (service as any).updateProgress(run, 5, 3, 1.5, { period: 14 });

      expect(optimizationRunRepo.update).toHaveBeenCalledWith(
        run.id,
        expect.objectContaining({
          combinationsTested: 5,
          progressDetails: expect.objectContaining({
            autoResumeCount: 2,
            currentCombination: 5,
            currentBestScore: 1.5,
            currentBestParams: { period: 14 }
          })
        })
      );
    });

    it('should handle null progressDetails gracefully', async () => {
      const run = {
        id: 'run-1',
        startedAt: new Date(Date.now() - 60000),
        totalCombinations: 10,
        progressDetails: null
      } as unknown as OptimizationRun;

      optimizationRunRepo.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      await (service as any).updateProgress(run, 3, 2, 0.8, null);

      expect(optimizationRunRepo.update).toHaveBeenCalledWith(
        run.id,
        expect.objectContaining({
          progressDetails: expect.objectContaining({
            autoResumeCount: undefined,
            currentCombination: 3,
            currentBestParams: undefined
          })
        })
      );
    });
  });

  describe('cancelOptimization', () => {
    it('should cancel running optimization and remove from queue', async () => {
      const run = { id: 'run-1', status: OptimizationStatus.RUNNING } as OptimizationRun;
      optimizationRunRepo.findOne.mockResolvedValue(run);
      optimizationRunRepo.save.mockResolvedValue(run);

      await service.cancelOptimization('run-1');

      expect(run.status).toBe(OptimizationStatus.CANCELLED);
      expect(run.completedAt).toBeInstanceOf(Date);
      expect(optimizationQueue.remove).toHaveBeenCalledWith('run-1');
    });

    it('should cancel pending optimization', async () => {
      const run = { id: 'run-1', status: OptimizationStatus.PENDING } as OptimizationRun;
      optimizationRunRepo.findOne.mockResolvedValue(run);
      optimizationRunRepo.save.mockResolvedValue(run);

      await service.cancelOptimization('run-1');

      expect(run.status).toBe(OptimizationStatus.CANCELLED);
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
});
