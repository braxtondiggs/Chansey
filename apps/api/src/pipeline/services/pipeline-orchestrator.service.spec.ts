import { getQueueToken } from '@nestjs/bullmq';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';

import { StrategyGrade } from '@chansey/api-interfaces';

import { PipelineOrchestratorService } from './pipeline-orchestrator.service';

import { AlgorithmRegistry } from '../../algorithm/registry/algorithm-registry.service';
import { ExchangeKey } from '../../exchange/exchange-key/exchange-key.entity';
import { MarketRegimeService } from '../../market-regime/market-regime.service';
import { OptimizationOrchestratorService } from '../../optimization/services/optimization-orchestrator.service';
import { BacktestService } from '../../order/backtest/backtest.service';
import { PaperTradingService } from '../../order/paper-trading/paper-trading.service';
import { ScoringService } from '../../scoring/scoring.service';
import { StrategyConfig } from '../../strategy/entities/strategy-config.entity';
import { User } from '../../users/users.entity';
import { CreatePipelineInput } from '../dto';
import { Pipeline } from '../entities/pipeline.entity';
import { DEFAULT_PROGRESSION_RULES, DeploymentRecommendation, PipelineStage, PipelineStatus } from '../interfaces';
import { pipelineConfig } from '../pipeline.config';

describe('PipelineOrchestratorService', () => {
  let service: PipelineOrchestratorService;
  let pipelineRepository: jest.Mocked<Repository<Pipeline>>;
  let strategyConfigRepository: jest.Mocked<Repository<StrategyConfig>>;
  let exchangeKeyRepository: jest.Mocked<Repository<ExchangeKey>>;
  let pipelineQueue: jest.Mocked<Queue>;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let scoringService: jest.Mocked<ScoringService>;
  let marketRegimeService: jest.Mocked<MarketRegimeService>;
  let algorithmRegistry: jest.Mocked<AlgorithmRegistry>;

  const mockUser: User = {
    id: 'user-123',
    email: 'test@example.com'
  } as User;

  const mockStrategyConfig = {
    id: 'strategy-123',
    name: 'Test Strategy',
    algorithmId: 'algo-123',
    parameters: { param1: 10 }
  } as unknown as StrategyConfig;

  const mockExchangeKey: ExchangeKey = {
    id: 'exchange-key-123',
    user: mockUser,
    exchange: { name: 'Binance' }
  } as unknown as ExchangeKey;

  const mockPipeline: Pipeline = {
    id: 'pipeline-123',
    name: 'Test Pipeline',
    status: PipelineStatus.PENDING,
    currentStage: PipelineStage.OPTIMIZE,
    strategyConfigId: 'strategy-123',
    exchangeKeyId: 'exchange-key-123',
    stageConfig: {
      optimization: {
        trainDays: 90,
        testDays: 30,
        stepDays: 30,
        objectiveMetric: 'sharpe_ratio'
      },
      historical: {
        startDate: '2023-01-01',
        endDate: '2024-01-01',
        initialCapital: 10000
      },
      liveReplay: {
        startDate: '2024-01-01',
        endDate: '2024-03-01',
        initialCapital: 10000
      },
      paperTrading: {
        initialCapital: 10000,
        duration: '7d'
      }
    },
    progressionRules: DEFAULT_PROGRESSION_RULES,
    user: mockUser,
    strategyConfig: mockStrategyConfig,
    exchangeKey: mockExchangeKey,
    createdAt: new Date(),
    updatedAt: new Date()
  } as Pipeline;

  const mockCreateDto: CreatePipelineInput = {
    name: 'Test Pipeline',
    strategyConfigId: 'strategy-123',
    exchangeKeyId: 'exchange-key-123',
    stageConfig: mockPipeline.stageConfig
  };

  /** Default mock score result returned by ScoringService.calculateScoreFromMetrics */
  const mockScoreResult = {
    overallScore: 55,
    grade: StrategyGrade.C,
    componentScores: {
      sharpeRatio: { value: 1.0, score: 75, weight: 0.25, percentile: 0 },
      calmarRatio: { value: 1.0, score: 75, weight: 0.15, percentile: 0 },
      winRate: { value: 0.5, score: 50, weight: 0.1, percentile: 0 },
      profitFactor: { value: 1.0, score: 25, weight: 0.1, percentile: 0 },
      wfaDegradation: { value: 10, score: 100, weight: 0.2, percentile: 0 },
      stability: { value: 50, score: 75, weight: 0.1, percentile: 0 },
      correlation: { value: 0, score: 100, weight: 0.1, percentile: 0 }
    },
    warnings: [],
    regimeModifier: 0
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PipelineOrchestratorService,
        {
          provide: getRepositoryToken(Pipeline),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            findAndCount: jest.fn(),
            update: jest.fn(),
            remove: jest.fn()
          }
        },
        {
          provide: getRepositoryToken(StrategyConfig),
          useValue: {
            findOne: jest.fn()
          }
        },
        {
          provide: getRepositoryToken(ExchangeKey),
          useValue: {
            findOne: jest.fn()
          }
        },
        {
          provide: getQueueToken('pipeline'),
          useValue: {
            add: jest.fn(),
            remove: jest.fn()
          }
        },
        {
          provide: pipelineConfig.KEY,
          useValue: {
            queue: 'pipeline',
            telemetryStream: 'pipeline:telemetry',
            telemetryStreamMaxLen: 50000,
            concurrency: 2,
            timeoutMs: 3600000,
            defaultProgressionRules: DEFAULT_PROGRESSION_RULES
          } as ConfigType<typeof pipelineConfig>
        },
        {
          provide: OptimizationOrchestratorService,
          useValue: {
            startOptimization: jest.fn(),
            cancelOptimization: jest.fn()
          }
        },
        {
          provide: BacktestService,
          useValue: {
            createBacktest: jest.fn(),
            pauseBacktest: jest.fn(),
            resumeBacktest: jest.fn(),
            cancelBacktest: jest.fn()
          }
        },
        {
          provide: PaperTradingService,
          useValue: {
            startFromPipeline: jest.fn(),
            pause: jest.fn(),
            resume: jest.fn(),
            stop: jest.fn()
          }
        },
        {
          provide: ScoringService,
          useValue: {
            calculateScoreFromMetrics: jest.fn().mockReturnValue(mockScoreResult)
          }
        },
        {
          provide: MarketRegimeService,
          useValue: {
            getCurrentRegime: jest.fn().mockResolvedValue({ regime: 'normal' })
          }
        },
        {
          provide: AlgorithmRegistry,
          useValue: {
            getStrategyForAlgorithm: jest.fn()
          }
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn()
          }
        },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn((cb) => cb({ save: jest.fn() }))
          }
        }
      ]
    }).compile();

    service = module.get<PipelineOrchestratorService>(PipelineOrchestratorService);
    pipelineRepository = module.get(getRepositoryToken(Pipeline));
    strategyConfigRepository = module.get(getRepositoryToken(StrategyConfig));
    exchangeKeyRepository = module.get(getRepositoryToken(ExchangeKey));
    pipelineQueue = module.get(getQueueToken('pipeline'));
    eventEmitter = module.get(EventEmitter2);
    scoringService = module.get(ScoringService);
    marketRegimeService = module.get(MarketRegimeService);
    algorithmRegistry = module.get(AlgorithmRegistry);
  });

  describe('createPipeline', () => {
    it('should create a pipeline successfully', async () => {
      strategyConfigRepository.findOne.mockResolvedValue(mockStrategyConfig);
      exchangeKeyRepository.findOne.mockResolvedValue(mockExchangeKey);
      pipelineRepository.create.mockReturnValue(mockPipeline);
      pipelineRepository.save.mockResolvedValue(mockPipeline);
      pipelineRepository.findOne.mockResolvedValue(mockPipeline);

      const result = await service.createPipeline(mockCreateDto, mockUser);

      expect(result).toEqual(mockPipeline);
      expect(strategyConfigRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockCreateDto.strategyConfigId }
      });
      expect(exchangeKeyRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockCreateDto.exchangeKeyId },
        relations: ['user', 'exchange']
      });
      expect(pipelineRepository.create).toHaveBeenCalled();
      expect(pipelineRepository.save).toHaveBeenCalled();
    });

    it('should throw NotFoundException if strategy config not found', async () => {
      strategyConfigRepository.findOne.mockResolvedValue(null);

      await expect(service.createPipeline(mockCreateDto, mockUser)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if exchange key not found', async () => {
      strategyConfigRepository.findOne.mockResolvedValue(mockStrategyConfig);
      exchangeKeyRepository.findOne.mockResolvedValue(null);

      await expect(service.createPipeline(mockCreateDto, mockUser)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if exchange key belongs to another user', async () => {
      strategyConfigRepository.findOne.mockResolvedValue(mockStrategyConfig);
      exchangeKeyRepository.findOne.mockResolvedValue({
        ...mockExchangeKey,
        user: { id: 'other-user' }
      } as unknown as ExchangeKey);

      await expect(service.createPipeline(mockCreateDto, mockUser)).rejects.toThrow(ForbiddenException);
    });

    it('should use initialStage when provided', async () => {
      strategyConfigRepository.findOne.mockResolvedValue(mockStrategyConfig);
      exchangeKeyRepository.findOne.mockResolvedValue(mockExchangeKey);
      pipelineRepository.create.mockReturnValue(mockPipeline);
      pipelineRepository.save.mockResolvedValue(mockPipeline);
      pipelineRepository.findOne.mockResolvedValue(mockPipeline);

      await service.createPipeline({ ...mockCreateDto, initialStage: PipelineStage.HISTORICAL }, mockUser);

      expect(pipelineRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ currentStage: PipelineStage.HISTORICAL })
      );
    });

    it('should default to OPTIMIZE when initialStage not provided', async () => {
      strategyConfigRepository.findOne.mockResolvedValue(mockStrategyConfig);
      exchangeKeyRepository.findOne.mockResolvedValue(mockExchangeKey);
      pipelineRepository.create.mockReturnValue(mockPipeline);
      pipelineRepository.save.mockResolvedValue(mockPipeline);
      pipelineRepository.findOne.mockResolvedValue(mockPipeline);

      await service.createPipeline(mockCreateDto, mockUser);

      expect(pipelineRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ currentStage: PipelineStage.OPTIMIZE })
      );
    });
  });

  describe('recordOptimizationSkipped', () => {
    it('should write synthetic SKIPPED optimization result', async () => {
      pipelineRepository.findOne.mockResolvedValue({ ...mockPipeline, stageResults: {} } as Pipeline);
      pipelineRepository.save.mockResolvedValue(mockPipeline);

      await service.recordOptimizationSkipped('pipeline-123');

      expect(pipelineRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          stageResults: expect.objectContaining({
            optimization: expect.objectContaining({
              runId: 'skipped',
              status: 'COMPLETED',
              bestScore: 0,
              improvement: 0
            })
          })
        })
      );
    });

    it('should do nothing when pipeline not found', async () => {
      pipelineRepository.findOne.mockResolvedValue(null);

      await service.recordOptimizationSkipped('nonexistent');

      expect(pipelineRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('startPipeline', () => {
    it('should start a pending pipeline', async () => {
      const pendingPipeline = { ...mockPipeline, status: PipelineStatus.PENDING };
      pipelineRepository.findOne.mockResolvedValue(pendingPipeline);

      const result = await service.startPipeline('pipeline-123', mockUser);

      expect(pipelineQueue.add).toHaveBeenCalledWith(
        'execute-stage',
        expect.objectContaining({
          pipelineId: 'pipeline-123',
          stage: PipelineStage.OPTIMIZE
        }),
        expect.any(Object)
      );
    });

    it('should throw BadRequestException if pipeline is already running', async () => {
      const runningPipeline = { ...mockPipeline, status: PipelineStatus.RUNNING };
      pipelineRepository.findOne.mockResolvedValue(runningPipeline);

      await expect(service.startPipeline('pipeline-123', mockUser)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if pipeline is completed', async () => {
      const completedPipeline = { ...mockPipeline, status: PipelineStatus.COMPLETED };
      pipelineRepository.findOne.mockResolvedValue(completedPipeline);

      await expect(service.startPipeline('pipeline-123', mockUser)).rejects.toThrow(BadRequestException);
    });
  });

  describe('pausePipeline', () => {
    it('should pause a running pipeline', async () => {
      const runningPipeline = { ...mockPipeline, status: PipelineStatus.RUNNING };
      pipelineRepository.findOne.mockResolvedValue(runningPipeline);
      pipelineRepository.save.mockResolvedValue({
        ...runningPipeline,
        status: PipelineStatus.PAUSED
      });

      await service.pausePipeline('pipeline-123', mockUser);

      expect(pipelineRepository.save).toHaveBeenCalledWith(expect.objectContaining({ status: PipelineStatus.PAUSED }));
    });

    it('should throw BadRequestException if pipeline is not running', async () => {
      pipelineRepository.findOne.mockResolvedValue(mockPipeline);

      await expect(service.pausePipeline('pipeline-123', mockUser)).rejects.toThrow(BadRequestException);
    });
  });

  describe('resumePipeline', () => {
    it('should resume a paused pipeline', async () => {
      const pausedPipeline = { ...mockPipeline, status: PipelineStatus.PAUSED };
      pipelineRepository.findOne.mockResolvedValue(pausedPipeline);
      pipelineRepository.save.mockResolvedValue({
        ...pausedPipeline,
        status: PipelineStatus.RUNNING
      });

      await service.resumePipeline('pipeline-123', mockUser);

      expect(pipelineRepository.save).toHaveBeenCalledWith(expect.objectContaining({ status: PipelineStatus.RUNNING }));
    });

    it('should throw BadRequestException if pipeline is not paused', async () => {
      pipelineRepository.findOne.mockResolvedValue(mockPipeline);

      await expect(service.resumePipeline('pipeline-123', mockUser)).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancelPipeline', () => {
    it('should cancel a running pipeline', async () => {
      const runningPipeline = { ...mockPipeline, status: PipelineStatus.RUNNING };
      pipelineRepository.findOne.mockResolvedValue(runningPipeline);

      await service.cancelPipeline('pipeline-123', mockUser);

      expect(pipelineQueue.remove).toHaveBeenCalled();
    });

    it('should throw BadRequestException if pipeline is already completed', async () => {
      const completedPipeline = { ...mockPipeline, status: PipelineStatus.COMPLETED };
      pipelineRepository.findOne.mockResolvedValue(completedPipeline);

      await expect(service.cancelPipeline('pipeline-123', mockUser)).rejects.toThrow(BadRequestException);
    });
  });

  describe('handleOptimizationComplete', () => {
    it('should advance to historical stage on successful optimization', async () => {
      const runningPipeline = {
        ...mockPipeline,
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.OPTIMIZE,
        user: mockUser
      };
      pipelineRepository.findOne.mockResolvedValue(runningPipeline);
      pipelineRepository.save.mockResolvedValue(runningPipeline);

      await service.handleOptimizationComplete(
        'opt-run-123',
        'strategy-123',
        { param1: 15 },
        1.5,
        10 // 10% improvement
      );

      expect(pipelineRepository.save).toHaveBeenCalled();
      expect(pipelineQueue.add).toHaveBeenCalledWith(
        'execute-stage',
        expect.objectContaining({
          stage: PipelineStage.HISTORICAL
        }),
        expect.any(Object)
      );
    });

    it('should fail pipeline if improvement threshold not met', async () => {
      const runningPipeline = {
        ...mockPipeline,
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.OPTIMIZE,
        progressionRules: { ...DEFAULT_PROGRESSION_RULES, optimization: { minImprovement: 10 } },
        user: mockUser
      };
      pipelineRepository.findOne.mockResolvedValue(runningPipeline);
      pipelineRepository.save.mockResolvedValue(runningPipeline);

      await service.handleOptimizationComplete(
        'opt-run-123',
        'strategy-123',
        { param1: 15 },
        1.5,
        3 // Only 3% improvement, below 10% threshold
      );

      expect(pipelineRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: PipelineStatus.FAILED,
          failureReason: expect.stringContaining('3.00% < min 10.00%')
        })
      );
    });
  });

  describe('handleBacktestComplete', () => {
    it.each([
      {
        scenario: 'good metrics',
        backtestId: 'backtest-123',
        metrics: {
          sharpeRatio: 1.5,
          totalReturn: 0.15,
          maxDrawdown: 0.1,
          winRate: 0.55,
          totalTrades: 50,
          profitFactor: 2.0,
          volatility: 0.3
        }
      },
      {
        scenario: 'terrible metrics',
        backtestId: 'backtest-bad',
        metrics: {
          sharpeRatio: -1,
          totalReturn: -0.5,
          maxDrawdown: 0.8,
          winRate: 0.1,
          totalTrades: 5,
          profitFactor: 0.5,
          volatility: 0.8
        }
      }
    ])('should auto-advance HISTORICAL to LIVE_REPLAY with $scenario', async ({ backtestId, metrics }) => {
      const runningPipeline = {
        ...mockPipeline,
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.HISTORICAL,
        historicalBacktestId: backtestId,
        user: mockUser
      };
      pipelineRepository.findOne.mockResolvedValue(runningPipeline);
      pipelineRepository.save.mockResolvedValue(runningPipeline);

      await service.handleBacktestComplete(backtestId, 'HISTORICAL', metrics);

      expect(pipelineRepository.save).toHaveBeenCalled();
      expect(pipelineQueue.add).toHaveBeenCalledWith(
        'execute-stage',
        expect.objectContaining({ stage: PipelineStage.LIVE_REPLAY }),
        expect.any(Object)
      );
      expect(scoringService.calculateScoreFromMetrics).not.toHaveBeenCalled();
    });

    it('should advance LIVE_REPLAY to PAPER_TRADE when score >= 30', async () => {
      const runningPipeline = {
        ...mockPipeline,
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.LIVE_REPLAY,
        liveReplayBacktestId: 'backtest-lr-123',
        stageResults: {
          historical: { status: 'COMPLETED', totalReturn: 0.15 }
        },
        user: mockUser
      } as Pipeline;
      pipelineRepository.findOne.mockResolvedValue(runningPipeline);
      pipelineRepository.save.mockResolvedValue(runningPipeline);
      scoringService.calculateScoreFromMetrics.mockReturnValue({
        ...mockScoreResult,
        overallScore: 55
      });

      await service.handleBacktestComplete('backtest-lr-123', 'LIVE_REPLAY', {
        sharpeRatio: 1.0,
        totalReturn: 0.12,
        maxDrawdown: 0.15,
        winRate: 0.5,
        totalTrades: 50,
        profitFactor: 1.5,
        volatility: 0.25
      });

      expect(scoringService.calculateScoreFromMetrics).toHaveBeenCalled();
      expect(pipelineQueue.add).toHaveBeenCalledWith(
        'execute-stage',
        expect.objectContaining({ stage: PipelineStage.PAPER_TRADE }),
        expect.any(Object)
      );
    });

    it('should fail LIVE_REPLAY when score < 30', async () => {
      const runningPipeline = {
        ...mockPipeline,
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.LIVE_REPLAY,
        liveReplayBacktestId: 'backtest-lr-fail',
        stageResults: {
          historical: { status: 'COMPLETED', totalReturn: 0.15 }
        },
        user: mockUser
      } as Pipeline;
      pipelineRepository.findOne.mockResolvedValue(runningPipeline);
      pipelineRepository.save.mockResolvedValue(runningPipeline);
      scoringService.calculateScoreFromMetrics.mockReturnValue({
        ...mockScoreResult,
        overallScore: 20,
        grade: StrategyGrade.F
      });

      await service.handleBacktestComplete('backtest-lr-fail', 'LIVE_REPLAY', {
        sharpeRatio: -0.5,
        totalReturn: -0.3,
        maxDrawdown: 0.6,
        winRate: 0.2,
        totalTrades: 10,
        profitFactor: 0.3,
        volatility: 0.7
      });

      expect(pipelineRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: PipelineStatus.FAILED,
          failureReason: expect.stringContaining('score 20.0 < minimum 30')
        })
      );
    });

    it('should apply regime modifier correctly', async () => {
      const runningPipeline = {
        ...mockPipeline,
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.LIVE_REPLAY,
        liveReplayBacktestId: 'backtest-lr-regime',
        stageResults: {
          historical: { status: 'COMPLETED', totalReturn: 0.15 }
        },
        user: mockUser
      } as Pipeline;
      pipelineRepository.findOne.mockResolvedValue(runningPipeline);
      pipelineRepository.save.mockResolvedValue(runningPipeline);

      marketRegimeService.getCurrentRegime.mockResolvedValue({ regime: 'extreme' } as any);
      scoringService.calculateScoreFromMetrics.mockReturnValue({
        ...mockScoreResult,
        overallScore: 45,
        regimeModifier: 15
      });

      await service.handleBacktestComplete('backtest-lr-regime', 'LIVE_REPLAY', {
        sharpeRatio: 0.5,
        totalReturn: 0.05,
        maxDrawdown: 0.2,
        winRate: 0.45,
        totalTrades: 30,
        profitFactor: 1.1,
        volatility: 0.35
      });

      expect(scoringService.calculateScoreFromMetrics).toHaveBeenCalledWith(
        expect.objectContaining({ sharpeRatio: 0.5 }),
        expect.any(Number),
        { marketRegime: 'extreme' }
      );
    });

    it('should gracefully handle regime service failure with modifier=0', async () => {
      const runningPipeline = {
        ...mockPipeline,
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.LIVE_REPLAY,
        liveReplayBacktestId: 'backtest-lr-no-regime',
        stageResults: {
          historical: { status: 'COMPLETED', totalReturn: 0.15 }
        },
        user: mockUser
      } as Pipeline;
      pipelineRepository.findOne.mockResolvedValue(runningPipeline);
      pipelineRepository.save.mockResolvedValue(runningPipeline);

      marketRegimeService.getCurrentRegime.mockRejectedValue(new Error('Redis unavailable'));
      scoringService.calculateScoreFromMetrics.mockReturnValue({
        ...mockScoreResult,
        overallScore: 55,
        regimeModifier: 0
      });

      await service.handleBacktestComplete('backtest-lr-no-regime', 'LIVE_REPLAY', {
        sharpeRatio: 1.0,
        totalReturn: 0.12,
        maxDrawdown: 0.15,
        winRate: 0.5,
        totalTrades: 50,
        profitFactor: 1.5,
        volatility: 0.25
      });

      // Should still work — calls scoring with undefined regime
      expect(scoringService.calculateScoreFromMetrics).toHaveBeenCalledWith(expect.any(Object), expect.any(Number), {
        marketRegime: undefined
      });
      // Should advance (score 55 >= 30)
      expect(pipelineQueue.add).toHaveBeenCalledWith(
        'execute-stage',
        expect.objectContaining({ stage: PipelineStage.PAPER_TRADE }),
        expect.any(Object)
      );
    });

    it('should store score on pipeline entity', async () => {
      const runningPipeline = {
        ...mockPipeline,
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.LIVE_REPLAY,
        liveReplayBacktestId: 'backtest-lr-store',
        stageResults: {
          historical: { status: 'COMPLETED', totalReturn: 0.15 }
        },
        user: mockUser
      } as Pipeline;
      pipelineRepository.findOne.mockResolvedValue(runningPipeline);
      pipelineRepository.save.mockResolvedValue(runningPipeline);

      scoringService.calculateScoreFromMetrics.mockReturnValue({
        ...mockScoreResult,
        overallScore: 72,
        grade: StrategyGrade.B
      });

      await service.handleBacktestComplete('backtest-lr-store', 'LIVE_REPLAY', {
        sharpeRatio: 1.5,
        totalReturn: 0.2,
        maxDrawdown: 0.1,
        winRate: 0.6,
        totalTrades: 80,
        profitFactor: 2.5,
        volatility: 0.2
      });

      expect(pipelineRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          pipelineScore: 72,
          scoreGrade: StrategyGrade.B,
          scoringRegime: 'normal'
        })
      );
    });

    it('should pass score exactly 30 (>= 30)', async () => {
      const runningPipeline = {
        ...mockPipeline,
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.LIVE_REPLAY,
        liveReplayBacktestId: 'backtest-lr-edge',
        stageResults: {
          historical: { status: 'COMPLETED', totalReturn: 0.1 }
        },
        user: mockUser
      } as Pipeline;
      pipelineRepository.findOne.mockResolvedValue(runningPipeline);
      pipelineRepository.save.mockResolvedValue(runningPipeline);

      scoringService.calculateScoreFromMetrics.mockReturnValue({
        ...mockScoreResult,
        overallScore: 30,
        grade: StrategyGrade.F
      });

      await service.handleBacktestComplete('backtest-lr-edge', 'LIVE_REPLAY', {
        sharpeRatio: 0.3,
        totalReturn: 0.02,
        maxDrawdown: 0.25,
        winRate: 0.4,
        totalTrades: 20,
        profitFactor: 1.0,
        volatility: 0.4
      });

      // Score exactly 30 should pass
      expect(pipelineQueue.add).toHaveBeenCalledWith(
        'execute-stage',
        expect.objectContaining({ stage: PipelineStage.PAPER_TRADE }),
        expect.any(Object)
      );
    });
  });

  describe('recommendation based on score', () => {
    it('should recommend DEPLOY when score >= 70', async () => {
      const runningPipeline = {
        ...mockPipeline,
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.PAPER_TRADE,
        progressionRules: {
          ...DEFAULT_PROGRESSION_RULES,
          paperTrading: { minSharpeRatio: 0.3, minTotalReturn: 0, maxDrawdown: 0.5, minWinRate: 0.3 }
        },
        stageResults: {
          optimization: { status: 'COMPLETED' },
          historical: { status: 'COMPLETED', totalReturn: 0.2 },
          liveReplay: { status: 'COMPLETED', totalReturn: 0.18 },
          scoring: { overallScore: 75, grade: StrategyGrade.B }
        }
      } as Pipeline;

      pipelineRepository.findOne.mockResolvedValue(runningPipeline);
      pipelineRepository.save.mockResolvedValue(runningPipeline);

      await service.handlePaperTradingComplete(
        'session-1',
        runningPipeline.id,
        {
          initialCapital: 10000,
          currentPortfolioValue: 12000,
          totalReturn: 0.17,
          totalReturnPercent: 17,
          maxDrawdown: 0.15,
          sharpeRatio: 1.5,
          winRate: 0.6,
          totalTrades: 80,
          winningTrades: 48,
          losingTrades: 32,
          totalFees: 10,
          durationHours: 168
        },
        'duration_reached'
      );

      expect(runningPipeline.recommendation).toBe(DeploymentRecommendation.DEPLOY);
    });

    it('should recommend DEPLOY even when optimization was skipped (no stageResults.optimization)', async () => {
      const runningPipeline = {
        ...mockPipeline,
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.PAPER_TRADE,
        progressionRules: {
          ...DEFAULT_PROGRESSION_RULES,
          paperTrading: { minSharpeRatio: 0.3, minTotalReturn: 0, maxDrawdown: 0.5, minWinRate: 0.3 }
        },
        stageResults: {
          historical: { status: 'COMPLETED', totalReturn: 0.2 },
          liveReplay: { status: 'COMPLETED', totalReturn: 0.18 },
          scoring: { overallScore: 75, grade: StrategyGrade.B }
        }
      } as Pipeline;

      pipelineRepository.findOne.mockResolvedValue(runningPipeline);
      pipelineRepository.save.mockResolvedValue(runningPipeline);

      await service.handlePaperTradingComplete(
        'session-skipped-opt',
        runningPipeline.id,
        {
          initialCapital: 10000,
          currentPortfolioValue: 12000,
          totalReturn: 0.17,
          totalReturnPercent: 17,
          maxDrawdown: 0.15,
          sharpeRatio: 1.5,
          winRate: 0.6,
          totalTrades: 80,
          winningTrades: 48,
          losingTrades: 32,
          totalFees: 10,
          durationHours: 168
        },
        'duration_reached'
      );

      expect(runningPipeline.recommendation).toBe(DeploymentRecommendation.DEPLOY);
    });

    it('should recommend NEEDS_REVIEW when score 30-69', async () => {
      const runningPipeline = {
        ...mockPipeline,
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.PAPER_TRADE,
        progressionRules: {
          ...DEFAULT_PROGRESSION_RULES,
          paperTrading: { minSharpeRatio: 0.3, minTotalReturn: 0, maxDrawdown: 0.5, minWinRate: 0.3 }
        },
        stageResults: {
          optimization: { status: 'COMPLETED' },
          historical: { status: 'COMPLETED', totalReturn: 0.1 },
          liveReplay: { status: 'COMPLETED', totalReturn: 0.08 },
          scoring: { overallScore: 50, grade: StrategyGrade.C }
        }
      } as Pipeline;

      pipelineRepository.findOne.mockResolvedValue(runningPipeline);
      pipelineRepository.save.mockResolvedValue(runningPipeline);

      await service.handlePaperTradingComplete(
        'session-2',
        runningPipeline.id,
        {
          initialCapital: 10000,
          currentPortfolioValue: 10800,
          totalReturn: 0.07,
          totalReturnPercent: 7,
          maxDrawdown: 0.2,
          sharpeRatio: 0.6,
          winRate: 0.45,
          totalTrades: 40,
          winningTrades: 18,
          losingTrades: 22,
          totalFees: 5,
          durationHours: 168
        },
        'duration_reached'
      );

      expect(runningPipeline.recommendation).toBe(DeploymentRecommendation.NEEDS_REVIEW);
    });
  });

  describe('executeStage', () => {
    it('should skip execution when pipeline is not running', async () => {
      const pausedPipeline = { ...mockPipeline, status: PipelineStatus.PAUSED } as Pipeline;
      pipelineRepository.findOne.mockResolvedValue(pausedPipeline);

      await service.executeStage('pipeline-123', PipelineStage.OPTIMIZE);

      expect((service as any).optimizationService.startOptimization).not.toHaveBeenCalled();
    });

    it('should execute optimization stage by building ParameterSpace at runtime', async () => {
      const runningPipeline = {
        ...mockPipeline,
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.OPTIMIZE,
        strategyConfig: mockStrategyConfig
      } as Pipeline;
      pipelineRepository.findOne.mockResolvedValue(runningPipeline);
      pipelineRepository.save.mockResolvedValue(runningPipeline);

      // Mock strategy with config schema
      algorithmRegistry.getStrategyForAlgorithm.mockResolvedValue({
        id: 'ema-crossover-001',
        getConfigSchema: () => ({
          enabled: { type: 'boolean', default: true },
          fastPeriod: { type: 'number', default: 12, min: 5, max: 50 },
          slowPeriod: { type: 'number', default: 26, min: 10, max: 100 }
        }),
        getParameterConstraints: () => [{ type: 'less_than' as const, param1: 'fastPeriod', param2: 'slowPeriod' }]
      } as any);

      const optimizationService = (service as any).optimizationService as jest.Mocked<OptimizationOrchestratorService>;
      optimizationService.startOptimization.mockResolvedValue({ id: 'opt-run-1' } as any);

      await service.executeStage('pipeline-123', PipelineStage.OPTIMIZE);

      expect(algorithmRegistry.getStrategyForAlgorithm).toHaveBeenCalledWith('algo-123');
      expect(optimizationService.startOptimization).toHaveBeenCalledWith(
        runningPipeline.strategyConfigId,
        expect.objectContaining({
          strategyType: 'ema-crossover-001',
          parameters: expect.arrayContaining([
            expect.objectContaining({ name: 'fastPeriod' }),
            expect.objectContaining({ name: 'slowPeriod' })
          ])
        }),
        expect.objectContaining({
          method: 'random_search',
          objective: expect.objectContaining({ metric: runningPipeline.stageConfig.optimization!.objectiveMetric })
        })
      );
      expect(pipelineRepository.save).toHaveBeenCalledWith(expect.objectContaining({ optimizationRunId: 'opt-run-1' }));
    });

    it('should throw when optimization stage config is missing', async () => {
      const runningPipeline = {
        ...mockPipeline,
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.OPTIMIZE,
        strategyConfig: mockStrategyConfig,
        stageConfig: {
          ...mockPipeline.stageConfig,
          optimization: undefined
        }
      } as Pipeline;
      pipelineRepository.findOne.mockResolvedValue(runningPipeline);

      await expect(service.executeStage('pipeline-123', PipelineStage.OPTIMIZE)).rejects.toThrow(
        'optimization stage config is missing'
      );
    });

    it('should throw when strategy not found in registry for OPTIMIZE stage', async () => {
      const runningPipeline = {
        ...mockPipeline,
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.OPTIMIZE,
        strategyConfig: mockStrategyConfig
      } as Pipeline;
      pipelineRepository.findOne.mockResolvedValue(runningPipeline);

      algorithmRegistry.getStrategyForAlgorithm.mockResolvedValue(undefined);

      await expect(service.executeStage('pipeline-123', PipelineStage.OPTIMIZE)).rejects.toThrow(
        'strategy not found or has no config schema'
      );
    });
  });

  describe('handlePaperTradingComplete', () => {
    it('completes pipeline and publishes recommendation when thresholds pass', async () => {
      const runningPipeline = {
        ...mockPipeline,
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.PAPER_TRADE,
        progressionRules: {
          ...DEFAULT_PROGRESSION_RULES,
          paperTrading: {
            minSharpeRatio: 0.5,
            minTotalReturn: 0,
            maxDrawdown: 0.5,
            minWinRate: 0.4
          }
        },
        stageResults: {
          optimization: { status: 'COMPLETED' },
          historical: { status: 'COMPLETED', totalReturn: 0.2 },
          liveReplay: { status: 'COMPLETED', totalReturn: 0.18 }
        }
      } as Pipeline;

      pipelineRepository.findOne.mockResolvedValue(runningPipeline);
      pipelineRepository.save.mockResolvedValue(runningPipeline);

      await service.handlePaperTradingComplete(
        'session-1',
        runningPipeline.id,
        {
          initialCapital: 10000,
          currentPortfolioValue: 12000,
          totalReturn: 0.17,
          totalReturnPercent: 17,
          maxDrawdown: 0.2,
          sharpeRatio: 1.2,
          winRate: 0.6,
          totalTrades: 50,
          winningTrades: 30,
          losingTrades: 20,
          totalFees: 10,
          durationHours: 24
        },
        'duration_reached'
      );

      expect(runningPipeline.status).toBe(PipelineStatus.COMPLETED);
      expect(eventEmitter.emit).toHaveBeenCalled();
    });

    it('should fail pipeline when paper trading thresholds not met', async () => {
      const runningPipeline = {
        ...mockPipeline,
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.PAPER_TRADE,
        progressionRules: {
          ...DEFAULT_PROGRESSION_RULES,
          paperTrading: { minSharpeRatio: 1.0, minTotalReturn: 0.05, maxDrawdown: 0.2, minWinRate: 0.5 }
        },
        stageResults: {
          optimization: { status: 'COMPLETED' },
          historical: { status: 'COMPLETED', totalReturn: 0.2 },
          liveReplay: { status: 'COMPLETED', totalReturn: 0.18 }
        }
      } as Pipeline;

      pipelineRepository.findOne.mockResolvedValue(runningPipeline);
      pipelineRepository.save.mockResolvedValue(runningPipeline);

      await service.handlePaperTradingComplete(
        'session-fail',
        runningPipeline.id,
        {
          initialCapital: 10000,
          currentPortfolioValue: 9000,
          totalReturn: -0.1,
          totalReturnPercent: -10,
          maxDrawdown: 0.35,
          sharpeRatio: 0.2,
          winRate: 0.3,
          totalTrades: 20,
          winningTrades: 6,
          losingTrades: 14,
          totalFees: 5,
          durationHours: 168
        },
        'duration_reached'
      );

      expect(runningPipeline.status).toBe(PipelineStatus.FAILED);
      expect(runningPipeline.failureReason).toContain('Paper trading did not meet thresholds');
      expect(runningPipeline.recommendation).toBe(DeploymentRecommendation.DO_NOT_DEPLOY);
    });
  });

  describe('deletePipeline', () => {
    it('should delete a pending pipeline', async () => {
      pipelineRepository.findOne.mockResolvedValue(mockPipeline);

      await service.deletePipeline('pipeline-123', mockUser);

      expect(pipelineRepository.remove).toHaveBeenCalledWith(mockPipeline);
    });

    it('should throw BadRequestException if pipeline is running', async () => {
      const runningPipeline = { ...mockPipeline, status: PipelineStatus.RUNNING };
      pipelineRepository.findOne.mockResolvedValue(runningPipeline);

      await expect(service.deletePipeline('pipeline-123', mockUser)).rejects.toThrow(BadRequestException);
    });
  });
});
