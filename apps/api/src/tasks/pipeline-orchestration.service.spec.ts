import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { StrategyStatus } from '@chansey/api-interfaces';

import {
  DEFAULT_RISK_LEVEL,
  PIPELINE_STANDARD_CAPITAL,
  buildStageConfigFromRisk,
  getOptimizationConfig,
  getPaperTradingDuration
} from './dto/pipeline-orchestration.dto';
import { PipelineOrchestrationService } from './pipeline-orchestration.service';

import { AlgorithmService } from '../algorithm/algorithm.service';
import { AlgorithmRegistry } from '../algorithm/registry/algorithm-registry.service';
import { ExchangeKey } from '../exchange/exchange-key/exchange-key.entity';
import { Pipeline } from '../pipeline/entities/pipeline.entity';
import { PipelineStage, PipelineStatus } from '../pipeline/interfaces';
import { PipelineOrchestratorService } from '../pipeline/services/pipeline-orchestrator.service';
import { StrategyConfig } from '../strategy/entities/strategy-config.entity';
import { User } from '../users/users.entity';
import { UsersService } from '../users/users.service';

describe('PipelineOrchestrationService', () => {
  let service: PipelineOrchestrationService;
  let userRepository: jest.Mocked<Repository<User>>;
  let pipelineRepository: jest.Mocked<Repository<Pipeline>>;
  let strategyConfigRepository: jest.Mocked<Repository<StrategyConfig>>;
  let exchangeKeyRepository: jest.Mocked<Repository<ExchangeKey>>;
  let usersService: jest.Mocked<UsersService>;
  let pipelineOrchestrator: jest.Mocked<PipelineOrchestratorService>;
  let algorithmService: jest.Mocked<AlgorithmService>;
  let algorithmRegistry: jest.Mocked<AlgorithmRegistry>;

  const mockUser: Partial<User> = {
    id: 'user-123',
    email: 'test@example.com',
    algoTradingEnabled: true,
    risk: { id: 'risk-1', level: 3 } as any
  };

  const mockExchangeKey: Partial<ExchangeKey> = {
    id: 'exchange-key-123',
    userId: 'user-123',
    isActive: true,
    exchange: { id: 'exchange-1', name: 'Binance' } as any
  };

  const mockStrategyConfig: Partial<StrategyConfig> = {
    id: 'strategy-123',
    name: 'Test Strategy',
    status: StrategyStatus.VALIDATED,
    algorithmId: 'algo-123',
    algorithm: { id: 'algo-123', name: 'RSI' } as any
  };

  const mockPipeline: Partial<Pipeline> = {
    id: 'pipeline-123',
    name: 'Auto: Test Strategy - 2024-01-01',
    status: PipelineStatus.PENDING
  };

  beforeEach(async () => {
    const mockQueryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([mockUser]),
      getOne: jest.fn().mockResolvedValue(null)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PipelineOrchestrationService,
        {
          provide: getRepositoryToken(User),
          useValue: {
            createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder)
          }
        },
        {
          provide: getRepositoryToken(Pipeline),
          useValue: {
            createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder)
          }
        },
        {
          provide: getRepositoryToken(StrategyConfig),
          useValue: {
            find: jest.fn().mockResolvedValue([mockStrategyConfig]),
            create: jest.fn().mockImplementation((data) => data),
            save: jest.fn().mockImplementation((data) => Promise.resolve({ id: 'new-config-id', ...data }))
          }
        },
        {
          provide: getRepositoryToken(ExchangeKey),
          useValue: {
            findOne: jest.fn().mockResolvedValue(mockExchangeKey)
          }
        },
        {
          provide: UsersService,
          useValue: {
            getById: jest.fn().mockResolvedValue(mockUser)
          }
        },
        {
          provide: PipelineOrchestratorService,
          useValue: {
            createPipeline: jest.fn().mockResolvedValue(mockPipeline),
            startPipeline: jest.fn().mockResolvedValue(mockPipeline),
            recordOptimizationSkipped: jest.fn().mockResolvedValue(undefined)
          }
        },
        {
          provide: AlgorithmService,
          useValue: {
            getAlgorithmsForTesting: jest.fn().mockResolvedValue([])
          }
        },
        {
          provide: AlgorithmRegistry,
          useValue: {
            getStrategyForAlgorithm: jest.fn().mockResolvedValue(undefined)
          }
        }
      ]
    }).compile();

    service = module.get<PipelineOrchestrationService>(PipelineOrchestrationService);
    userRepository = module.get(getRepositoryToken(User));
    pipelineRepository = module.get(getRepositoryToken(Pipeline));
    strategyConfigRepository = module.get(getRepositoryToken(StrategyConfig));
    exchangeKeyRepository = module.get(getRepositoryToken(ExchangeKey));
    usersService = module.get(UsersService);
    pipelineOrchestrator = module.get(PipelineOrchestratorService);
    algorithmService = module.get(AlgorithmService);
    algorithmRegistry = module.get(AlgorithmRegistry);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getEligibleUsers', () => {
    it('should return users with algo trading enabled and active exchange keys', async () => {
      const result = await service.getEligibleUsers();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('user-123');
    });

    it('should return empty array on error', async () => {
      userRepository.createQueryBuilder = jest.fn().mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = await service.getEligibleUsers();

      expect(result).toEqual([]);
    });
  });

  describe('getUserExchangeKey', () => {
    it('should return user primary exchange key', async () => {
      const result = await service.getUserExchangeKey('user-123');

      expect(result).toEqual(mockExchangeKey);
      expect(exchangeKeyRepository.findOne).toHaveBeenCalledWith({
        where: {
          userId: 'user-123',
          isActive: true
        },
        order: {
          createdAt: 'ASC'
        },
        relations: ['exchange']
      });
    });

    it('should return null when no exchange key found', async () => {
      exchangeKeyRepository.findOne = jest.fn().mockResolvedValue(null);

      const result = await service.getUserExchangeKey('user-123');

      expect(result).toBeNull();
    });
  });

  describe('getEligibleStrategyConfigs', () => {
    it('should return validated and testing strategy configs', async () => {
      const result = await service.getEligibleStrategyConfigs();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('strategy-123');
      expect(strategyConfigRepository.find).toHaveBeenCalledWith({
        where: [{ status: StrategyStatus.VALIDATED }, { status: StrategyStatus.TESTING }],
        relations: ['algorithm']
      });
    });
  });

  describe('checkDuplicate', () => {
    it('should return false when no duplicate exists', async () => {
      const result = await service.checkDuplicate('strategy-123', 'user-123');

      expect(result).toBe(false);
    });

    it('should return true when duplicate exists', async () => {
      const mockQB = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'existing-pipeline' })
      };
      pipelineRepository.createQueryBuilder = jest.fn().mockReturnValue(mockQB);

      const result = await service.checkDuplicate('strategy-123', 'user-123');

      expect(result).toBe(true);
    });
  });

  describe('orchestrateForUser', () => {
    it('should create pipelines for eligible strategy configs', async () => {
      const result = await service.orchestrateForUser('user-123');

      expect(result.userId).toBe('user-123');
      expect(result.pipelinesCreated).toBe(1);
      expect(result.pipelineIds).toContain('pipeline-123');
      expect(result.skippedConfigs).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(pipelineOrchestrator.createPipeline).toHaveBeenCalled();
      expect(pipelineOrchestrator.startPipeline).toHaveBeenCalled();
    });

    it('should skip when no exchange key', async () => {
      exchangeKeyRepository.findOne = jest.fn().mockResolvedValue(null);

      const result = await service.orchestrateForUser('user-123');

      expect(result.pipelinesCreated).toBe(0);
      expect(result.errors).toContain('No active exchange key');
    });

    it('should skip duplicate pipelines', async () => {
      const mockQB = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'existing-pipeline' })
      };
      pipelineRepository.createQueryBuilder = jest.fn().mockReturnValue(mockQB);

      const result = await service.orchestrateForUser('user-123');

      expect(result.pipelinesCreated).toBe(0);
      expect(result.skippedConfigs).toHaveLength(1);
      expect(result.skippedConfigs[0].reason).toContain('Duplicate');
    });

    it('should pass initialStage=HISTORICAL when no strategy is registered', async () => {
      // algorithmRegistry returns undefined → no ParameterSpace → HISTORICAL
      algorithmRegistry.getStrategyForAlgorithm.mockResolvedValue(undefined);

      const result = await service.orchestrateForUser('user-123');

      expect(result.pipelinesCreated).toBe(1);
      expect(pipelineOrchestrator.createPipeline).toHaveBeenCalledWith(
        expect.objectContaining({ initialStage: PipelineStage.HISTORICAL }),
        expect.any(Object)
      );
      expect(pipelineOrchestrator.recordOptimizationSkipped).toHaveBeenCalledWith('pipeline-123');
    });

    it('should pass initialStage=OPTIMIZE when strategy has optimizable schema', async () => {
      // Mock a strategy that returns a schema with optimizable params
      algorithmRegistry.getStrategyForAlgorithm.mockResolvedValue({
        id: 'ema-crossover-001',
        getConfigSchema: () => ({
          enabled: { type: 'boolean', default: true },
          weight: { type: 'number', default: 1.0, min: 0, max: 10 },
          fastPeriod: { type: 'number', default: 12, min: 5, max: 50 },
          slowPeriod: { type: 'number', default: 26, min: 10, max: 100 }
        }),
        getParameterConstraints: () => [{ type: 'less_than' as const, param1: 'fastPeriod', param2: 'slowPeriod' }]
      } as any);

      const result = await service.orchestrateForUser('user-123');

      expect(result.pipelinesCreated).toBe(1);
      expect(pipelineOrchestrator.createPipeline).toHaveBeenCalledWith(
        expect.objectContaining({
          initialStage: PipelineStage.OPTIMIZE
        }),
        expect.any(Object)
      );
      expect(pipelineOrchestrator.recordOptimizationSkipped).not.toHaveBeenCalled();
    });

    it('should NOT call seedStrategyConfigsFromAlgorithms (moved to task scheduler)', async () => {
      const seedSpy = jest.spyOn(service, 'seedStrategyConfigsFromAlgorithms');

      await service.orchestrateForUser('user-123');

      expect(seedSpy).not.toHaveBeenCalled();
      seedSpy.mockRestore();
    });
  });

  describe('seedStrategyConfigsFromAlgorithms', () => {
    it('should skip algorithms that already have a strategy config', async () => {
      algorithmService.getAlgorithmsForTesting.mockResolvedValue([
        { id: 'algo-123', name: 'RSI', config: {}, version: '1.0.0' } as any
      ]);
      // Return existing config for algo-123
      strategyConfigRepository.find = jest
        .fn()
        .mockResolvedValue([{ algorithmId: 'algo-123', status: StrategyStatus.TESTING }]);

      const seeded = await service.seedStrategyConfigsFromAlgorithms();

      expect(seeded).toBe(0);
      expect(strategyConfigRepository.save).not.toHaveBeenCalled();
    });

    it('should return 0 when no algorithms found', async () => {
      algorithmService.getAlgorithmsForTesting.mockResolvedValue([]);

      const seeded = await service.seedStrategyConfigsFromAlgorithms();

      expect(seeded).toBe(0);
    });

    it('should use default parameters when algorithm config is empty', async () => {
      algorithmService.getAlgorithmsForTesting.mockResolvedValue([
        { id: 'algo-no-config', name: 'No Config Algo', config: null, version: null } as any
      ]);
      strategyConfigRepository.find = jest.fn().mockResolvedValue([]);

      await service.seedStrategyConfigsFromAlgorithms();

      expect(strategyConfigRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parameters: {},
          version: '1.0.0'
        })
      );
    });
  });
});

describe('Pipeline Orchestration DTOs', () => {
  describe('getPaperTradingDuration', () => {
    it('should return correct duration for each risk level', () => {
      expect(getPaperTradingDuration(1)).toBe('14d');
      expect(getPaperTradingDuration(2)).toBe('10d');
      expect(getPaperTradingDuration(3)).toBe('7d');
      expect(getPaperTradingDuration(4)).toBe('5d');
      expect(getPaperTradingDuration(5)).toBe('3d');
    });

    it('should return default duration for invalid risk level', () => {
      expect(getPaperTradingDuration(0)).toBe('7d');
      expect(getPaperTradingDuration(6)).toBe('7d');
      expect(getPaperTradingDuration(100)).toBe('7d');
    });
  });

  describe('getOptimizationConfig', () => {
    it('should return correct config for each risk level', () => {
      const config1 = getOptimizationConfig(1);
      expect(config1.trainDays).toBe(180);
      expect(config1.maxCombinations).toBe(1000);

      const config3 = getOptimizationConfig(3);
      expect(config3.trainDays).toBe(90);
      expect(config3.maxCombinations).toBe(500);

      const config5 = getOptimizationConfig(5);
      expect(config5.trainDays).toBe(30);
      expect(config5.maxCombinations).toBe(200);
    });

    it('should return default config for invalid risk level', () => {
      const config = getOptimizationConfig(100);
      expect(config.trainDays).toBe(90);
      expect(config.maxCombinations).toBe(500);
    });
  });

  describe('buildStageConfigFromRisk', () => {
    it('should build complete stage config for risk level 3', () => {
      const config = buildStageConfigFromRisk(3);

      // Optimization stage
      expect(config.optimization!.trainDays).toBe(90);
      expect(config.optimization!.testDays).toBe(30);
      expect(config.optimization!.objectiveMetric).toBe('sharpe_ratio');
      expect(config.optimization!.maxCombinations).toBe(500);
      expect(config.optimization!.earlyStop).toBe(true);

      // Historical stage
      expect(config.historical.initialCapital).toBe(PIPELINE_STANDARD_CAPITAL);
      expect(config.historical.tradingFee).toBe(0.001);

      // Live replay stage
      expect(config.liveReplay.initialCapital).toBe(PIPELINE_STANDARD_CAPITAL);
      expect(config.liveReplay.enablePacing).toBe(false);

      // Paper trading stage
      expect(config.paperTrading.initialCapital).toBe(PIPELINE_STANDARD_CAPITAL);
      expect(config.paperTrading.duration).toBe('7d');
      expect(config.paperTrading.stopConditions?.maxDrawdown).toBe(0.25);
    });

    it('should build conservative config for risk level 1', () => {
      const config = buildStageConfigFromRisk(1);

      expect(config.optimization!.trainDays).toBe(180);
      expect(config.optimization!.maxCombinations).toBe(1000);
      expect(config.paperTrading.duration).toBe('14d');
    });

    it('should build aggressive config for risk level 5', () => {
      const config = buildStageConfigFromRisk(5);

      expect(config.optimization!.trainDays).toBe(30);
      expect(config.optimization!.maxCombinations).toBe(200);
      expect(config.paperTrading.duration).toBe('3d');
    });
  });

  describe('Constants', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_RISK_LEVEL).toBe(3);
      expect(PIPELINE_STANDARD_CAPITAL).toBe(10000);
    });
  });
});
