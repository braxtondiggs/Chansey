import { getQueueToken } from '@nestjs/bullmq';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';

import { PipelineOrchestratorService } from './pipeline-orchestrator.service';

import { ExchangeKey } from '../../exchange/exchange-key/exchange-key.entity';
import { OptimizationOrchestratorService } from '../../optimization/services/optimization-orchestrator.service';
import { BacktestService } from '../../order/backtest/backtest.service';
import { PaperTradingService } from '../../order/paper-trading/paper-trading.service';
import { StrategyConfig } from '../../strategy/entities/strategy-config.entity';
import { User } from '../../users/users.entity';
import { CreatePipelineInput } from '../dto';
import { Pipeline } from '../entities/pipeline.entity';
import { DEFAULT_PROGRESSION_RULES, PipelineStage, PipelineStatus } from '../interfaces';
import { pipelineConfig } from '../pipeline.config';

describe('PipelineOrchestratorService', () => {
  let service: PipelineOrchestratorService;
  let pipelineRepository: jest.Mocked<Repository<Pipeline>>;
  let strategyConfigRepository: jest.Mocked<Repository<StrategyConfig>>;
  let exchangeKeyRepository: jest.Mocked<Repository<ExchangeKey>>;
  let pipelineQueue: jest.Mocked<Queue>;
  let eventEmitter: jest.Mocked<EventEmitter2>;

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
    it('should advance to live replay after historical backtest', async () => {
      const runningPipeline = {
        ...mockPipeline,
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.HISTORICAL,
        historicalBacktestId: 'backtest-123',
        user: mockUser
      };
      pipelineRepository.findOne.mockResolvedValue(runningPipeline);
      pipelineRepository.save.mockResolvedValue(runningPipeline);

      await service.handleBacktestComplete('backtest-123', 'HISTORICAL', {
        sharpeRatio: 1.5,
        totalReturn: 0.15,
        maxDrawdown: 0.1,
        winRate: 0.55,
        totalTrades: 50
      });

      expect(pipelineRepository.save).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalled();
    });
  });

  describe('executeStage', () => {
    it('should skip execution when pipeline is not running', async () => {
      const pausedPipeline = { ...mockPipeline, status: PipelineStatus.PAUSED } as Pipeline;
      pipelineRepository.findOne.mockResolvedValue(pausedPipeline);

      await service.executeStage('pipeline-123', PipelineStage.OPTIMIZE);

      expect((service as any).optimizationService.startOptimization).not.toHaveBeenCalled();
    });

    it('should execute optimization stage and persist run id', async () => {
      const runningPipeline = {
        ...mockPipeline,
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.OPTIMIZE,
        strategyConfig: mockStrategyConfig
      } as Pipeline;
      pipelineRepository.findOne.mockResolvedValue(runningPipeline);
      pipelineRepository.save.mockResolvedValue(runningPipeline);

      const optimizationService = (service as any).optimizationService as jest.Mocked<OptimizationOrchestratorService>;
      optimizationService.startOptimization.mockResolvedValue({ id: 'opt-run-1' } as any);

      await service.executeStage('pipeline-123', PipelineStage.OPTIMIZE);

      expect(optimizationService.startOptimization).toHaveBeenCalledWith(
        runningPipeline.strategyConfigId,
        runningPipeline.strategyConfig.parameters as any,
        expect.objectContaining({
          method: 'grid_search',
          objective: expect.objectContaining({ metric: runningPipeline.stageConfig.optimization.objectiveMetric })
        })
      );
      expect(pipelineRepository.save).toHaveBeenCalledWith(expect.objectContaining({ optimizationRunId: 'opt-run-1' }));
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
