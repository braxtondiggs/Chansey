import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { BacktestOrchestrationService } from './backtest-orchestration.service';
import { getRiskConfig, MIN_ORCHESTRATION_CAPITAL, RISK_CONFIG_MATRIX } from './dto/backtest-orchestration.dto';

import { AlgorithmActivation } from '../algorithm/algorithm-activation.entity';
import { AlgorithmActivationService } from '../algorithm/services/algorithm-activation.service';
import { BalanceService } from '../balance/balance.service';
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
  let balanceService: jest.Mocked<BalanceService>;
  let algorithmActivationService: jest.Mocked<AlgorithmActivationService>;
  let backtestService: jest.Mocked<BacktestService>;

  const mockUser: Partial<User> = {
    id: 'user-123',
    algoTradingEnabled: true,
    algoCapitalAllocationPercentage: 25,
    risk: { id: 'risk-1', level: 3, name: 'Moderate', description: '' } as Risk,
    exchanges: []
  };

  const mockActivation: Partial<AlgorithmActivation> = {
    id: 'activation-1',
    userId: 'user-123',
    algorithmId: 'algo-1',
    isActive: true,
    allocationPercentage: 10,
    algorithm: { id: 'algo-1', name: 'Test Algorithm' } as any,
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
          provide: BalanceService,
          useValue: {
            getUserBalances: jest.fn().mockResolvedValue({ totalUsdValue: 10000 })
          }
        },
        {
          provide: AlgorithmActivationService,
          useValue: {
            findUserActiveAlgorithms: jest.fn().mockResolvedValue([])
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
        }
      ]
    }).compile();

    service = module.get<BacktestOrchestrationService>(BacktestOrchestrationService);
    userRepository = module.get(getRepositoryToken(User));
    backtestRepository = module.get(getRepositoryToken(Backtest));
    marketDataSetRepository = module.get(getRepositoryToken(MarketDataSet));
    balanceService = module.get(BalanceService);
    algorithmActivationService = module.get(AlgorithmActivationService);
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
    it('should query users with algoTradingEnabled and valid risk', async () => {
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockUser])
      };
      (userRepository.createQueryBuilder as jest.Mock).mockReturnValue(mockQueryBuilder);

      const result = await service.getEligibleUsers();

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

  describe('calculateAllocatedCapital', () => {
    it('should calculate capital based on portfolio and allocation percentages', async () => {
      balanceService.getUserBalances.mockResolvedValue({ totalUsdValue: 100000 } as any);

      const user = { ...mockUser, algoCapitalAllocationPercentage: 25 } as User;
      const activation = { ...mockActivation, allocationPercentage: 10 } as AlgorithmActivation;

      const result = await service.calculateAllocatedCapital(user, activation);

      // 100000 * 0.25 * 0.10 = 2500
      expect(result).toBe(2500);
    });

    it('should return minimum capital when calculated value is below minimum', async () => {
      balanceService.getUserBalances.mockResolvedValue({ totalUsdValue: 5000 } as any);

      const user = { ...mockUser, algoCapitalAllocationPercentage: 10 } as User;
      const activation = { ...mockActivation, allocationPercentage: 5 } as AlgorithmActivation;

      const result = await service.calculateAllocatedCapital(user, activation);

      // 5000 * 0.10 * 0.05 = 25, but min is 1000
      expect(result).toBe(MIN_ORCHESTRATION_CAPITAL);
    });

    it('should return minimum capital when portfolio value is zero', async () => {
      balanceService.getUserBalances.mockResolvedValue({ totalUsdValue: 0 } as any);

      const result = await service.calculateAllocatedCapital(mockUser as User, mockActivation as AlgorithmActivation);

      expect(result).toBe(MIN_ORCHESTRATION_CAPITAL);
    });

    it('should return minimum capital on balance fetch error', async () => {
      balanceService.getUserBalances.mockRejectedValue(new Error('Balance fetch failed'));

      const result = await service.calculateAllocatedCapital(mockUser as User, mockActivation as AlgorithmActivation);

      expect(result).toBe(MIN_ORCHESTRATION_CAPITAL);
    });

    it('should use default allocation percentages when values are missing', async () => {
      balanceService.getUserBalances.mockResolvedValue({ totalUsdValue: 10000 } as any);

      const user = { ...mockUser, algoCapitalAllocationPercentage: undefined } as User;
      const activation = { ...mockActivation, allocationPercentage: undefined } as AlgorithmActivation;

      const result = await service.calculateAllocatedCapital(user, activation);

      // Defaults to 0% user allocation and 1% activation allocation, min capital applies.
      expect(result).toBe(MIN_ORCHESTRATION_CAPITAL);
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
      expect(fallbackQueryBuilder.take).toHaveBeenCalledWith(1);
    });
  });

  describe('orchestrateForUser', () => {
    it('should return empty result when user has no active activations', async () => {
      algorithmActivationService.findUserActiveAlgorithms.mockResolvedValue([]);

      const result = await service.orchestrateForUser('user-123');

      expect(result.backtestsCreated).toBe(0);
      expect(result.backtestIds).toHaveLength(0);
    });

    it('should skip duplicate backtests', async () => {
      algorithmActivationService.findUserActiveAlgorithms.mockResolvedValue([mockActivation as AlgorithmActivation]);

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

    it('should create backtest for valid activation', async () => {
      algorithmActivationService.findUserActiveAlgorithms.mockResolvedValue([mockActivation as AlgorithmActivation]);
      balanceService.getUserBalances.mockResolvedValue({ totalUsdValue: 10000 } as any);

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
          algorithmId: 'algo-1'
        })
      );
    });

    it('should skip when no dataset is available', async () => {
      algorithmActivationService.findUserActiveAlgorithms.mockResolvedValue([mockActivation as AlgorithmActivation]);

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
      algorithmActivationService.findUserActiveAlgorithms.mockResolvedValue([mockActivation as AlgorithmActivation]);

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

      expect(result.errors[0]).toContain('Failed to process activation');
      expect(result.skippedAlgorithms[0].reason).toContain('Create failed');
      expect(result.backtestsCreated).toBe(0);
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
        mockActivation as AlgorithmActivation,
        riskConfig,
        2500,
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
  });
});
