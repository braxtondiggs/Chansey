import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { BacktestOrchestrationService } from './backtest-orchestration.service';
import {
  BACKTEST_STANDARD_CAPITAL,
  DEFAULT_RISK_LEVEL,
  getRiskConfig,
  MIN_DATASET_INTEGRITY_SCORE,
  RISK_CONFIG_MATRIX
} from './dto/backtest-orchestration.dto';

import { Algorithm, AlgorithmCategory, AlgorithmStatus } from '../algorithm/algorithm.entity';
import { AlgorithmService } from '../algorithm/algorithm.service';
import { OHLCService } from '../ohlc/ohlc.service';
import { Backtest, BacktestStatus, BacktestType } from '../order/backtest/backtest.entity';
import { BacktestService } from '../order/backtest/backtest.service';
import { MarketDataSet, MarketDataTimeframe } from '../order/backtest/market-data-set.entity';
import { SlippageModelType } from '../order/backtest/slippage-model';
import { Risk } from '../risk/risk.entity';
import { User } from '../users/users.entity';
import { UsersService } from '../users/users.service';

describe('BacktestOrchestrationService', () => {
  let service: BacktestOrchestrationService;
  let userRepository: jest.Mocked<Repository<User>>;
  let backtestRepository: jest.Mocked<Repository<Backtest>>;
  let marketDataSetRepository: jest.Mocked<Repository<MarketDataSet>>;
  let usersService: jest.Mocked<UsersService>;
  let algorithmService: jest.Mocked<AlgorithmService>;
  let backtestService: jest.Mocked<BacktestService>;

  const mockUser: Partial<User> = {
    id: 'user-123',
    algoTradingEnabled: true,
    algoCapitalAllocationPercentage: 25,
    risk: { id: 'risk-1', level: 3, name: 'Moderate', description: '' } as Risk,
    exchanges: []
  };

  const mockAlgorithm: Partial<Algorithm> = {
    id: 'algo-1',
    name: 'Test Algorithm',
    status: AlgorithmStatus.ACTIVE,
    evaluate: true,
    category: AlgorithmCategory.TECHNICAL,
    config: { parameters: { param1: 'value1' } }
  };

  const mockDataset: Partial<MarketDataSet> = {
    id: 'dataset-1',
    label: 'Test Dataset',
    timeframe: MarketDataTimeframe.HOUR,
    integrityScore: 85,
    endAt: new Date()
  };

  beforeEach(async () => {
    const mockQueryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getOne: jest.fn().mockResolvedValue(null)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BacktestOrchestrationService,
        {
          provide: getRepositoryToken(User),
          useValue: {
            createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder)
          }
        },
        {
          provide: getRepositoryToken(Backtest),
          useValue: {
            createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
            update: jest.fn().mockResolvedValue({}),
            findOne: jest.fn().mockResolvedValue(null)
          }
        },
        {
          provide: getRepositoryToken(MarketDataSet),
          useValue: {
            createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder)
          }
        },
        {
          provide: UsersService,
          useValue: {
            getById: jest.fn().mockResolvedValue(mockUser)
          }
        },
        {
          provide: AlgorithmService,
          useValue: {
            getAlgorithmsForTesting: jest.fn().mockResolvedValue([])
          }
        },
        {
          provide: BacktestService,
          useValue: {
            createBacktest: jest.fn().mockResolvedValue({
              id: 'backtest-1',
              configSnapshot: {}
            })
          }
        },
        {
          provide: OHLCService,
          useValue: {
            getCandleDataDateRange: jest.fn().mockResolvedValue(null),
            getCoinsWithCandleData: jest.fn().mockResolvedValue([])
          }
        }
      ]
    }).compile();

    service = module.get<BacktestOrchestrationService>(BacktestOrchestrationService);
    userRepository = module.get(getRepositoryToken(User));
    backtestRepository = module.get(getRepositoryToken(Backtest));
    marketDataSetRepository = module.get(getRepositoryToken(MarketDataSet));
    usersService = module.get(UsersService);
    algorithmService = module.get(AlgorithmService);
    backtestService = module.get(BacktestService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getRiskConfig', () => {
    it('should return correct config for each risk level', () => {
      expect(getRiskConfig(1).lookbackDays).toBe(180);
      expect(getRiskConfig(1).slippageModel).toBe(SlippageModelType.VOLUME_BASED);
      expect(getRiskConfig(1).slippageBps).toBe(10);
      expect(getRiskConfig(1).tradingFee).toBe(0.0015);

      expect(getRiskConfig(3).lookbackDays).toBe(90);
      expect(getRiskConfig(3).slippageModel).toBe(SlippageModelType.FIXED);
      expect(getRiskConfig(3).slippageBps).toBe(5);
      expect(getRiskConfig(3).tradingFee).toBe(0.001);

      expect(getRiskConfig(5).lookbackDays).toBe(30);
      expect(getRiskConfig(5).slippageBps).toBe(3);
      expect(getRiskConfig(5).tradingFee).toBe(0.0008);
    });

    it('should return default config for invalid risk levels', () => {
      const defaultConfig = RISK_CONFIG_MATRIX[3];
      expect(getRiskConfig(0)).toEqual(defaultConfig);
      expect(getRiskConfig(6)).toEqual(defaultConfig);
      expect(getRiskConfig(-1)).toEqual(defaultConfig);
    });
  });

  describe('getEligibleUsers', () => {
    it('should query users with algoTradingEnabled', async () => {
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockUser])
      };
      (userRepository.createQueryBuilder as jest.Mock).mockReturnValue(mockQueryBuilder);

      const result = await service.getEligibleUsers();

      expect(userRepository.createQueryBuilder).toHaveBeenCalledWith('user');
      expect(mockQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('user.risk', 'risk');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('user.algoTradingEnabled = :enabled', { enabled: true });
      expect(result).toHaveLength(1);
    });

    it('should return empty array on error', async () => {
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockRejectedValue(new Error('Database error'))
      };
      (userRepository.createQueryBuilder as jest.Mock).mockReturnValue(mockQueryBuilder);

      const result = await service.getEligibleUsers();

      expect(result).toEqual([]);
    });
  });

  describe('isDuplicate', () => {
    it('should return true if non-failed backtest exists within 24 hours', async () => {
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'existing-backtest' })
      };
      (backtestRepository.createQueryBuilder as jest.Mock).mockReturnValue(mockQueryBuilder);

      const result = await service.isDuplicate('user-123', 'algo-1');

      expect(result).toBe(true);
    });

    it('should return false if no matching backtest exists', async () => {
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null)
      };
      (backtestRepository.createQueryBuilder as jest.Mock).mockReturnValue(mockQueryBuilder);

      const result = await service.isDuplicate('user-123', 'algo-1');

      expect(result).toBe(false);
    });

    it('should exclude failed and cancelled backtests from duplicate check', async () => {
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null)
      };
      (backtestRepository.createQueryBuilder as jest.Mock).mockReturnValue(mockQueryBuilder);

      await service.isDuplicate('user-123', 'algo-1');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('backtest.status NOT IN (:...failedStatuses)', {
        failedStatuses: [BacktestStatus.FAILED, BacktestStatus.CANCELLED]
      });
    });

    it('should constrain by user, algorithm, and recent time window', async () => {
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null)
      };
      (backtestRepository.createQueryBuilder as jest.Mock).mockReturnValue(mockQueryBuilder);

      await service.isDuplicate('user-123', 'algo-1');

      expect(mockQueryBuilder.where).toHaveBeenCalledWith('backtest.userId = :userId', { userId: 'user-123' });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('backtest.algorithmId = :algorithmId', {
        algorithmId: 'algo-1'
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('backtest.createdAt >= :since', {
        since: expect.any(Date)
      });
    });
  });

  describe('selectDataset', () => {
    it('should select dataset matching risk config timeframes', async () => {
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockDataset])
      };
      (marketDataSetRepository.createQueryBuilder as jest.Mock).mockReturnValue(mockQueryBuilder);

      const riskConfig = getRiskConfig(3);
      const result = await service.selectDataset(riskConfig);

      expect(result).toEqual(mockDataset);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('dataset.integrityScore >= :minIntegrity', {
        minIntegrity: MIN_DATASET_INTEGRITY_SCORE
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('dataset.endAt >= :cutoff', { cutoff: expect.any(Date) });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('dataset.timeframe IN (:...timeframes)', {
        timeframes: [MarketDataTimeframe.MINUTE, MarketDataTimeframe.HOUR]
      });
    });

    it('should return null when no suitable dataset exists', async () => {
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([])
      };
      (marketDataSetRepository.createQueryBuilder as jest.Mock).mockReturnValue(mockQueryBuilder);

      const riskConfig = getRiskConfig(3);
      const result = await service.selectDataset(riskConfig);

      expect(result).toBeNull();
    });

    it('should fall back when no dataset matches preferred timeframes', async () => {
      const primaryQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([])
      };
      const fallbackQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockDataset])
      };
      (marketDataSetRepository.createQueryBuilder as jest.Mock)
        .mockReturnValueOnce(primaryQueryBuilder)
        .mockReturnValueOnce(fallbackQueryBuilder);

      const riskConfig = getRiskConfig(3);
      const result = await service.selectDataset(riskConfig);

      expect(result).toEqual(mockDataset);
      expect(fallbackQueryBuilder.where).toHaveBeenCalledWith('dataset.integrityScore >= :minIntegrity', {
        minIntegrity: MIN_DATASET_INTEGRITY_SCORE
      });
      expect(fallbackQueryBuilder.andWhere).toHaveBeenCalledWith('dataset.endAt >= :cutoff', {
        cutoff: expect.any(Date)
      });
      expect(fallbackQueryBuilder.take).toHaveBeenCalledWith(1);
    });

    it('should return null when dataset selection fails', async () => {
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockRejectedValue(new Error('query failed'))
      };
      (marketDataSetRepository.createQueryBuilder as jest.Mock).mockReturnValue(mockQueryBuilder);

      const riskConfig = getRiskConfig(3);
      const result = await service.selectDataset(riskConfig);

      expect(result).toBeNull();
    });
  });

  describe('orchestrateForUser', () => {
    it('should return empty result when no testable algorithms exist', async () => {
      algorithmService.getAlgorithmsForTesting.mockResolvedValue([]);

      const result = await service.orchestrateForUser('user-123');

      expect(usersService.getById).toHaveBeenCalledWith('user-123', true);
      expect(result.backtestsCreated).toBe(0);
      expect(result.backtestIds).toHaveLength(0);
    });

    it('should skip duplicate backtests', async () => {
      algorithmService.getAlgorithmsForTesting.mockResolvedValue([mockAlgorithm as Algorithm]);

      // Mock isDuplicate to return true
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'existing' })
      };
      (backtestRepository.createQueryBuilder as jest.Mock).mockReturnValue(mockQueryBuilder);

      const result = await service.orchestrateForUser('user-123');

      expect(result.skippedAlgorithms).toHaveLength(1);
      expect(result.skippedAlgorithms[0].reason).toContain('Duplicate');
    });

    it('should create backtest for valid algorithm with standard capital', async () => {
      algorithmService.getAlgorithmsForTesting.mockResolvedValue([mockAlgorithm as Algorithm]);

      // Mock no duplicates
      const backtestQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null)
      };
      (backtestRepository.createQueryBuilder as jest.Mock).mockReturnValue(backtestQueryBuilder);

      // Mock dataset selection
      const datasetQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockDataset])
      };
      (marketDataSetRepository.createQueryBuilder as jest.Mock).mockReturnValue(datasetQueryBuilder);

      // Mock backtest creation
      backtestService.createBacktest.mockResolvedValue({
        id: 'new-backtest',
        configSnapshot: { algorithm: { id: 'algo-1' } }
      } as any);
      backtestRepository.findOne.mockResolvedValue({ id: 'new-backtest' } as any);

      const result = await service.orchestrateForUser('user-123');

      expect(result.backtestsCreated).toBe(1);
      expect(result.backtestIds).toContain('new-backtest');
      expect(backtestService.createBacktest).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: BacktestType.HISTORICAL,
          algorithmId: 'algo-1',
          initialCapital: BACKTEST_STANDARD_CAPITAL
        })
      );
    });

    it('should use default risk level when user has no risk', async () => {
      const userWithoutRisk = { ...mockUser, risk: undefined } as User;
      usersService.getById.mockResolvedValueOnce(userWithoutRisk);
      algorithmService.getAlgorithmsForTesting.mockResolvedValue([mockAlgorithm as Algorithm]);

      const backtestQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null)
      };
      (backtestRepository.createQueryBuilder as jest.Mock).mockReturnValue(backtestQueryBuilder);

      const datasetQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockDataset])
      };
      (marketDataSetRepository.createQueryBuilder as jest.Mock).mockReturnValue(datasetQueryBuilder);

      backtestService.createBacktest.mockResolvedValue({
        id: 'new-backtest',
        configSnapshot: { algorithm: { id: 'algo-1' } }
      } as any);
      backtestRepository.findOne.mockResolvedValue({ id: 'new-backtest' } as any);

      const selectDatasetSpy = jest.spyOn(service, 'selectDataset');

      await service.orchestrateForUser('user-123');

      expect(selectDatasetSpy).toHaveBeenCalledWith(getRiskConfig(DEFAULT_RISK_LEVEL));
    });

    it('should return errors when user lookup fails', async () => {
      usersService.getById.mockRejectedValueOnce(new Error('User not found'));

      const result = await service.orchestrateForUser('user-123');

      expect(result.errors[0]).toContain('Failed to orchestrate for user user-123: User not found');
      expect(result.backtestsCreated).toBe(0);
    });

    it('should use standard capital of $10,000 for all backtests', async () => {
      algorithmService.getAlgorithmsForTesting.mockResolvedValue([mockAlgorithm as Algorithm]);

      // Mock no duplicates
      const backtestQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null)
      };
      (backtestRepository.createQueryBuilder as jest.Mock).mockReturnValue(backtestQueryBuilder);

      // Mock dataset selection
      const datasetQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockDataset])
      };
      (marketDataSetRepository.createQueryBuilder as jest.Mock).mockReturnValue(datasetQueryBuilder);

      backtestService.createBacktest.mockResolvedValue({
        id: 'new-backtest',
        configSnapshot: {}
      } as any);
      backtestRepository.findOne.mockResolvedValue({ id: 'new-backtest' } as any);

      await service.orchestrateForUser('user-123');

      // Verify standard capital is used
      expect(backtestService.createBacktest).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          initialCapital: 10000
        })
      );
    });

    it('should skip when no dataset is available', async () => {
      algorithmService.getAlgorithmsForTesting.mockResolvedValue([mockAlgorithm as Algorithm]);

      const backtestQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null)
      };
      (backtestRepository.createQueryBuilder as jest.Mock).mockReturnValue(backtestQueryBuilder);

      const datasetQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([])
      };
      (marketDataSetRepository.createQueryBuilder as jest.Mock).mockReturnValue(datasetQueryBuilder);

      const result = await service.orchestrateForUser('user-123');

      expect(result.skippedAlgorithms).toHaveLength(1);
      expect(result.skippedAlgorithms[0].reason).toContain('No suitable dataset');
      expect(result.backtestsCreated).toBe(0);
    });

    it('should capture errors when backtest creation fails', async () => {
      algorithmService.getAlgorithmsForTesting.mockResolvedValue([mockAlgorithm as Algorithm]);

      const backtestQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null)
      };
      (backtestRepository.createQueryBuilder as jest.Mock).mockReturnValue(backtestQueryBuilder);

      const datasetQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockDataset])
      };
      (marketDataSetRepository.createQueryBuilder as jest.Mock).mockReturnValue(datasetQueryBuilder);

      backtestService.createBacktest.mockRejectedValue(new Error('Create failed'));

      const result = await service.orchestrateForUser('user-123');

      expect(result.errors[0]).toContain('Failed to process algorithm');
      expect(result.skippedAlgorithms[0].reason).toContain('Create failed');
      expect(result.backtestsCreated).toBe(0);
    });

    it('should process all testable algorithms for a user', async () => {
      const mockAlgorithm2: Partial<Algorithm> = {
        id: 'algo-2',
        name: 'Test Algorithm 2',
        status: AlgorithmStatus.ACTIVE,
        evaluate: true,
        category: AlgorithmCategory.TECHNICAL
      };

      algorithmService.getAlgorithmsForTesting.mockResolvedValue([
        mockAlgorithm as Algorithm,
        mockAlgorithm2 as Algorithm
      ]);

      // Mock no duplicates
      const backtestQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null)
      };
      (backtestRepository.createQueryBuilder as jest.Mock).mockReturnValue(backtestQueryBuilder);

      // Mock dataset selection
      const datasetQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockDataset])
      };
      (marketDataSetRepository.createQueryBuilder as jest.Mock).mockReturnValue(datasetQueryBuilder);

      // Mock backtest creation
      backtestService.createBacktest
        .mockResolvedValueOnce({
          id: 'backtest-1',
          configSnapshot: {}
        } as any)
        .mockResolvedValueOnce({
          id: 'backtest-2',
          configSnapshot: {}
        } as any);
      backtestRepository.findOne
        .mockResolvedValueOnce({ id: 'backtest-1' } as any)
        .mockResolvedValueOnce({ id: 'backtest-2' } as any);

      const result = await service.orchestrateForUser('user-123');

      expect(result.backtestsCreated).toBe(2);
      expect(result.backtestIds).toContain('backtest-1');
      expect(result.backtestIds).toContain('backtest-2');
    });
  });

  describe('createOrchestratedBacktest', () => {
    it('should update configSnapshot and return updated backtest', async () => {
      backtestService.createBacktest.mockResolvedValue({
        id: 'backtest-123',
        configSnapshot: { existing: true }
      } as any);
      backtestRepository.update.mockResolvedValue({} as any);
      backtestRepository.findOne.mockResolvedValue({ id: 'backtest-123' } as any);

      const riskConfig = getRiskConfig(3);
      const result = await service.createOrchestratedBacktest(
        mockUser as User,
        mockAlgorithm as Algorithm,
        riskConfig,
        BACKTEST_STANDARD_CAPITAL,
        mockDataset as MarketDataSet
      );

      expect(backtestRepository.update).toHaveBeenCalledWith('backtest-123', {
        configSnapshot: expect.objectContaining({
          orchestrated: true,
          riskLevel: 3
        })
      });
      expect(result).toEqual({ id: 'backtest-123' });
    });

    it('should use algorithm config parameters in backtest', async () => {
      backtestService.createBacktest.mockResolvedValue({
        id: 'backtest-123',
        configSnapshot: {}
      } as any);
      backtestRepository.findOne.mockResolvedValue({ id: 'backtest-123' } as any);

      const riskConfig = getRiskConfig(3);
      await service.createOrchestratedBacktest(
        mockUser as User,
        mockAlgorithm as Algorithm,
        riskConfig,
        BACKTEST_STANDARD_CAPITAL,
        mockDataset as MarketDataSet
      );

      expect(backtestService.createBacktest).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          strategyParams: { param1: 'value1' }
        })
      );
    });

    it('should throw when created backtest cannot be fetched', async () => {
      backtestService.createBacktest.mockResolvedValue({
        id: 'backtest-123',
        configSnapshot: {}
      } as any);
      backtestRepository.findOne.mockResolvedValue(null);

      const riskConfig = getRiskConfig(3);

      await expect(
        service.createOrchestratedBacktest(
          mockUser as User,
          mockAlgorithm as Algorithm,
          riskConfig,
          BACKTEST_STANDARD_CAPITAL,
          mockDataset as MarketDataSet
        )
      ).rejects.toThrow('Failed to fetch created backtest backtest-123');
    });
  });

  describe('BACKTEST_STANDARD_CAPITAL constant', () => {
    it('should be $10,000', () => {
      expect(BACKTEST_STANDARD_CAPITAL).toBe(10000);
    });
  });
});
