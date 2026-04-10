import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { StrategyStatus } from '@chansey/api-interfaces';

import {
  PIPELINE_STANDARD_CAPITAL,
  buildStageConfigFromRisk,
  getOptimizationConfig,
  getPaperTradingMinTrades
} from './dto/pipeline-orchestration.dto';
import { PipelineOrchestrationService } from './pipeline-orchestration.service';

import { AlgorithmService } from '../algorithm/algorithm.service';
import { AlgorithmRegistry } from '../algorithm/registry/algorithm-registry.service';
import { CoinSelectionService } from '../coin-selection/coin-selection.service';
import { ExchangeKey } from '../exchange/exchange-key/exchange-key.entity';
import { Pipeline } from '../pipeline/entities/pipeline.entity';
import { PipelineStage, PipelineStatus } from '../pipeline/interfaces';
import { PipelineOrchestratorService } from '../pipeline/services/pipeline-orchestrator.service';
import { CUSTOM_RISK_LEVEL, MIN_TRADING_COINS } from '../risk/risk.constants';
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
  let coinSelectionService: jest.Mocked<CoinSelectionService>;

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    algoTradingEnabled: true,
    coinRisk: { id: 'risk-1', level: 3 } as any,
    effectiveCalculationRiskLevel: 3
  } as unknown as User;

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
        },
        {
          provide: CoinSelectionService,
          useValue: {
            getManualCoinSelectionSymbols: jest.fn().mockResolvedValue([])
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
    coinSelectionService = module.get(CoinSelectionService);
  });

  describe('getEligibleUsers', () => {
    it('should return users with algo trading enabled and active exchange keys', async () => {
      const result = await service.getEligibleUsers();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('user-123');
    });

    it('should return empty array on database error', async () => {
      userRepository.createQueryBuilder = jest.fn().mockImplementation(() => {
        throw new Error('Database error');
      });

      const result = await service.getEligibleUsers();

      expect(result).toEqual([]);
    });
  });

  describe('getUserExchangeKey', () => {
    it('should query with correct params and return the key', async () => {
      const result = await service.getUserExchangeKey('user-123');

      expect(result).toEqual(mockExchangeKey);
      expect(exchangeKeyRepository.findOne).toHaveBeenCalledWith({
        where: { userId: 'user-123', isActive: true },
        order: { createdAt: 'ASC' },
        relations: ['exchange']
      });
    });

    it('should return null when no exchange key found', async () => {
      exchangeKeyRepository.findOne = jest.fn().mockResolvedValue(null);

      expect(await service.getUserExchangeKey('user-123')).toBeNull();
    });
  });

  describe('getEligibleStrategyConfigs', () => {
    it('should query for VALIDATED and TESTING strategy configs with algorithm relation', async () => {
      const result = await service.getEligibleStrategyConfigs();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('strategy-123');
      expect(strategyConfigRepository.find).toHaveBeenCalledWith({
        where: [{ status: StrategyStatus.VALIDATED }, { status: StrategyStatus.TESTING }],
        relations: ['algorithm']
      });
    });

    it('should return empty array on database error', async () => {
      strategyConfigRepository.find = jest.fn().mockRejectedValue(new Error('DB error'));

      const result = await service.getEligibleStrategyConfigs();

      expect(result).toEqual([]);
    });
  });

  describe('checkDuplicate', () => {
    it('should return false when no duplicate exists', async () => {
      expect(await service.checkDuplicate('strategy-123', 'user-123')).toBe(false);
    });

    it('should return true when duplicate exists', async () => {
      const mockQB = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'existing-pipeline' })
      };
      pipelineRepository.createQueryBuilder = jest.fn().mockReturnValue(mockQB);

      expect(await service.checkDuplicate('strategy-123', 'user-123')).toBe(true);
    });
  });

  describe('orchestrateForUser', () => {
    it('should create and start pipelines for eligible strategy configs', async () => {
      const result = await service.orchestrateForUser('user-123');

      expect(result).toEqual(
        expect.objectContaining({
          userId: 'user-123',
          pipelinesCreated: 1,
          pipelineIds: ['pipeline-123'],
          skippedConfigs: [],
          errors: []
        })
      );
      expect(pipelineOrchestrator.createPipeline).toHaveBeenCalled();
      expect(pipelineOrchestrator.startPipeline).toHaveBeenCalled();
    });

    it('should return early with error when no exchange key', async () => {
      exchangeKeyRepository.findOne = jest.fn().mockResolvedValue(null);

      const result = await service.orchestrateForUser('user-123');

      expect(result.pipelinesCreated).toBe(0);
      expect(result.errors).toContain('No active exchange key');
    });

    it('should return early when custom risk user has insufficient trading coins', async () => {
      const customRiskUser = {
        ...mockUser,
        coinRisk: { id: 'risk-1', level: CUSTOM_RISK_LEVEL } as any,
        effectiveCalculationRiskLevel: 3
      } as unknown as User;
      usersService.getById = jest.fn().mockResolvedValue(customRiskUser);
      coinSelectionService.getManualCoinSelectionSymbols = jest.fn().mockResolvedValue(['BTC']); // < MIN_TRADING_COINS

      const result = await service.orchestrateForUser('user-123');

      expect(result.pipelinesCreated).toBe(0);
      expect(result.errors[0]).toContain(`minimum ${MIN_TRADING_COINS} required`);
    });

    it('should return 0 pipelines when no eligible strategy configs', async () => {
      strategyConfigRepository.find = jest.fn().mockResolvedValue([]);

      const result = await service.orchestrateForUser('user-123');

      expect(result.pipelinesCreated).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.skippedConfigs).toHaveLength(0);
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

    it('should use initialStage=HISTORICAL and record skip when no optimizable strategy', async () => {
      algorithmRegistry.getStrategyForAlgorithm.mockResolvedValue(undefined);

      const result = await service.orchestrateForUser('user-123');

      expect(result.pipelinesCreated).toBe(1);
      expect(pipelineOrchestrator.createPipeline).toHaveBeenCalledWith(
        expect.objectContaining({ initialStage: PipelineStage.HISTORICAL }),
        expect.any(Object)
      );
      expect(pipelineOrchestrator.recordOptimizationSkipped).toHaveBeenCalledWith('pipeline-123');
    });

    it('should use initialStage=OPTIMIZE when strategy has optimizable parameters', async () => {
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
        expect.objectContaining({ initialStage: PipelineStage.OPTIMIZE }),
        expect.any(Object)
      );
      expect(pipelineOrchestrator.recordOptimizationSkipped).not.toHaveBeenCalled();
    });

    it('should capture error and continue when processStrategyConfig throws', async () => {
      pipelineOrchestrator.createPipeline.mockRejectedValue(new Error('Pipeline creation failed'));

      const result = await service.orchestrateForUser('user-123');

      expect(result.pipelinesCreated).toBe(0);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.skippedConfigs).toHaveLength(1);
      expect(result.skippedConfigs[0].reason).toContain('Pipeline creation failed');
    });

    it('should capture error when usersService.getById throws', async () => {
      usersService.getById = jest.fn().mockRejectedValue(new Error('User not found'));

      const result = await service.orchestrateForUser('user-123');

      expect(result.pipelinesCreated).toBe(0);
      expect(result.errors[0]).toContain('User not found');
    });
  });

  describe('seedStrategyConfigsFromAlgorithms', () => {
    it('should return 0 when no algorithms found', async () => {
      algorithmService.getAlgorithmsForTesting.mockResolvedValue([]);

      expect(await service.seedStrategyConfigsFromAlgorithms()).toBe(0);
    });

    it('should skip algorithms that already have a strategy config', async () => {
      algorithmService.getAlgorithmsForTesting.mockResolvedValue([
        { id: 'algo-123', name: 'RSI', config: {}, version: '1.0.0' } as any
      ]);
      strategyConfigRepository.find = jest
        .fn()
        .mockResolvedValue([{ algorithmId: 'algo-123', status: StrategyStatus.TESTING }]);

      const seeded = await service.seedStrategyConfigsFromAlgorithms();

      expect(seeded).toBe(0);
      expect(strategyConfigRepository.save).not.toHaveBeenCalled();
    });

    it('should create strategy config with correct defaults when algorithm config is empty', async () => {
      algorithmService.getAlgorithmsForTesting.mockResolvedValue([
        { id: 'algo-new', name: 'New Algo', config: null, version: null } as any
      ]);
      strategyConfigRepository.find = jest.fn().mockResolvedValue([]);

      const seeded = await service.seedStrategyConfigsFromAlgorithms();

      expect(seeded).toBe(1);
      expect(strategyConfigRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Auto: New Algo',
          algorithmId: 'algo-new',
          parameters: {},
          version: '1.0.0',
          status: StrategyStatus.TESTING
        })
      );
      expect(strategyConfigRepository.save).toHaveBeenCalled();
    });

    it('should return 0 on database error', async () => {
      algorithmService.getAlgorithmsForTesting.mockRejectedValue(new Error('DB error'));

      expect(await service.seedStrategyConfigsFromAlgorithms()).toBe(0);
    });
  });
});

describe('Pipeline Orchestration DTOs', () => {
  describe('getPaperTradingMinTrades', () => {
    it.each([
      [1, 50],
      [2, 45],
      [3, 40],
      [4, 35],
      [5, 30]
    ])('risk level %i should require %i minimum trades', (level, expected) => {
      expect(getPaperTradingMinTrades(level)).toBe(expected);
    });

    it.each([0, 6, 100])('invalid risk level %i should fall back to level 3 default (40)', (level) => {
      expect(getPaperTradingMinTrades(level)).toBe(40);
    });
  });

  describe('getOptimizationConfig', () => {
    it.each([
      [1, 180, 50],
      [3, 90, 30],
      [5, 30, 20]
    ])('risk level %i should use trainDays=%i, maxCombinations=%i', (level, trainDays, maxCombinations) => {
      const config = getOptimizationConfig(level);
      expect(config.trainDays).toBe(trainDays);
      expect(config.maxCombinations).toBe(maxCombinations);
    });

    it('should fall back to level 3 defaults for invalid risk level', () => {
      const config = getOptimizationConfig(100);
      expect(config.trainDays).toBe(90);
      expect(config.maxCombinations).toBe(30);
    });
  });

  describe('buildStageConfigFromRisk', () => {
    it('should build complete stage config with all four stages', () => {
      const config = buildStageConfigFromRisk(3);

      // Optimization
      if (!config.optimization) throw new Error('expected optimization config');
      expect(config.optimization.trainDays).toBe(90);
      expect(config.optimization.testDays).toBe(30);
      expect(config.optimization.objectiveMetric).toBe('sharpe_ratio');
      expect(config.optimization.maxCombinations).toBe(30);
      expect(config.optimization.earlyStop).toBe(true);

      // Historical
      expect(config.historical.initialCapital).toBe(PIPELINE_STANDARD_CAPITAL);
      expect(config.historical.tradingFee).toBe(0.001);
      expect(config.historical.startDate).toBeDefined();
      expect(config.historical.endDate).toBeDefined();

      // Live replay
      expect(config.liveReplay.initialCapital).toBe(PIPELINE_STANDARD_CAPITAL);
      expect(config.liveReplay.enablePacing).toBe(false);
      expect(config.liveReplay.startDate).toBeDefined();
      expect(config.liveReplay.endDate).toBeDefined();

      // Paper trading
      expect(config.paperTrading.initialCapital).toBe(PIPELINE_STANDARD_CAPITAL);
      expect(config.paperTrading.duration).toBe('30d');
      if (!config.paperTrading.stopConditions) throw new Error('expected stopConditions');
      expect(config.paperTrading.stopConditions.maxDrawdown).toBe(0.25);
      expect(config.paperTrading.stopConditions.targetReturn).toBe(0.5);
      expect(config.paperTrading.minTrades).toBe(40);
    });

    it('should produce date ranges where historical ends before live replay starts', () => {
      const config = buildStageConfigFromRisk(3);

      if (!config.historical.endDate) throw new Error('expected historical endDate');
      if (!config.liveReplay.startDate) throw new Error('expected liveReplay startDate');
      const historicalEnd = new Date(config.historical.endDate);
      const liveReplayStart = new Date(config.liveReplay.startDate);

      expect(historicalEnd.getTime()).toBeLessThanOrEqual(liveReplayStart.getTime());
    });
  });
});
