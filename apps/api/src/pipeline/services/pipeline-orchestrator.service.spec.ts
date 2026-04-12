import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DataSource, type Repository } from 'typeorm';

import { PipelineEventHandlerService } from './pipeline-event-handler.service';
import { PipelineOrchestratorService } from './pipeline-orchestrator.service';
import { PipelineProgressionService } from './pipeline-progression.service';
import { PipelineStageExecutionService } from './pipeline-stage-execution.service';

import { StrategyConfig } from '../../strategy/entities/strategy-config.entity';
import { type User } from '../../users/users.entity';
import { type CreatePipelineInput } from '../dto';
import { Pipeline } from '../entities/pipeline.entity';
import { DEFAULT_PROGRESSION_RULES, PipelineStage, PipelineStatus } from '../interfaces';

describe('PipelineOrchestratorService', () => {
  let service: PipelineOrchestratorService;
  let pipelineRepository: jest.Mocked<Repository<Pipeline>>;
  let strategyConfigRepository: jest.Mocked<Repository<StrategyConfig>>;
  let stageExecutionService: jest.Mocked<PipelineStageExecutionService>;
  let progressionService: jest.Mocked<PipelineProgressionService>;

  const mockUser: User = { id: 'user-123', email: 'test@example.com' } as User;

  const basePipeline: Pipeline = {
    id: 'pipeline-123',
    name: 'Test Pipeline',
    status: PipelineStatus.PENDING,
    currentStage: PipelineStage.OPTIMIZE,
    strategyConfigId: 'strategy-123',
    stageConfig: {
      historical: { startDate: '2023-01-01', endDate: '2024-01-01', initialCapital: 10000 },
      liveReplay: { startDate: '2024-01-01', endDate: '2024-03-01', initialCapital: 10000 },
      paperTrading: { initialCapital: 10000, duration: '7d' }
    },
    progressionRules: DEFAULT_PROGRESSION_RULES,
    user: mockUser
  } as Pipeline;

  const makePipeline = (overrides: Partial<Pipeline> = {}): Pipeline => ({ ...basePipeline, ...overrides }) as Pipeline;

  const mockCreateDto: CreatePipelineInput = {
    name: 'Test Pipeline',
    strategyConfigId: 'strategy-123',
    stageConfig: basePipeline.stageConfig
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
            remove: jest.fn(),
            update: jest.fn()
          }
        },
        {
          provide: getRepositoryToken(StrategyConfig),
          useValue: { findOne: jest.fn() }
        },
        {
          provide: DataSource,
          useValue: { transaction: jest.fn((cb) => cb({ save: jest.fn() })) }
        },
        {
          provide: PipelineStageExecutionService,
          useValue: {
            executeStage: jest.fn(),
            pauseCurrentStage: jest.fn(),
            resumeCurrentStage: jest.fn(),
            cancelCurrentStage: jest.fn(),
            enqueueStageJob: jest.fn(),
            removeStageJob: jest.fn()
          }
        },
        {
          provide: PipelineEventHandlerService,
          useValue: {
            handleOptimizationComplete: jest.fn(),
            handleOptimizationFailed: jest.fn(),
            handleBacktestComplete: jest.fn(),
            handlePaperTradingComplete: jest.fn()
          }
        },
        {
          provide: PipelineProgressionService,
          useValue: { advanceToNextStage: jest.fn() }
        }
      ]
    }).compile();

    service = module.get(PipelineOrchestratorService);
    pipelineRepository = module.get(getRepositoryToken(Pipeline));
    strategyConfigRepository = module.get(getRepositoryToken(StrategyConfig));
    stageExecutionService = module.get(PipelineStageExecutionService);
    progressionService = module.get(PipelineProgressionService);
  });

  describe('createPipeline', () => {
    it('creates a pipeline when strategy config exists', async () => {
      strategyConfigRepository.findOne.mockResolvedValue({ id: 'strategy-123' } as StrategyConfig);
      pipelineRepository.create.mockReturnValue(basePipeline);
      pipelineRepository.save.mockResolvedValue(basePipeline);
      pipelineRepository.findOne.mockResolvedValue(basePipeline);

      const result = await service.createPipeline(mockCreateDto, mockUser);

      expect(result).toEqual(basePipeline);
      expect(pipelineRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: mockCreateDto.name,
          strategyConfigId: 'strategy-123',
          status: PipelineStatus.PENDING,
          currentStage: PipelineStage.OPTIMIZE,
          user: mockUser
        })
      );
      expect(pipelineRepository.save).toHaveBeenCalled();
    });

    it('throws NotFoundException if strategy config missing', async () => {
      strategyConfigRepository.findOne.mockResolvedValue(null);
      await expect(service.createPipeline(mockCreateDto, mockUser)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findOne', () => {
    it('returns pipeline when found', async () => {
      pipelineRepository.findOne.mockResolvedValue(basePipeline);
      await expect(service.findOne('pipeline-123', mockUser)).resolves.toEqual(basePipeline);
    });

    it('throws NotFoundException when missing', async () => {
      pipelineRepository.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing', mockUser)).rejects.toThrow(NotFoundException);
    });
  });

  describe('startPipeline', () => {
    it('queues first stage when starting a pending pipeline', async () => {
      pipelineRepository.findOne.mockResolvedValue(makePipeline());
      await service.startPipeline('pipeline-123', mockUser);
      expect(pipelineRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'pipeline-123', status: PipelineStatus.RUNNING })
      );
      expect(stageExecutionService.enqueueStageJob).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'pipeline-123' }),
        PipelineStage.OPTIMIZE,
        mockUser.id
      );
    });

    it.each([[PipelineStatus.RUNNING], [PipelineStatus.COMPLETED], [PipelineStatus.CANCELLED]])(
      'throws BadRequest when status is %s',
      async (status) => {
        pipelineRepository.findOne.mockResolvedValue(makePipeline({ status }));
        await expect(service.startPipeline('pipeline-123', mockUser)).rejects.toThrow(BadRequestException);
        expect(stageExecutionService.enqueueStageJob).not.toHaveBeenCalled();
      }
    );

    it('marks pipeline FAILED and rethrows when enqueueStageJob fails', async () => {
      pipelineRepository.findOne.mockResolvedValue(makePipeline());
      stageExecutionService.enqueueStageJob.mockRejectedValueOnce(new Error('queue down'));

      await expect(service.startPipeline('pipeline-123', mockUser)).rejects.toThrow('queue down');

      expect(pipelineRepository.update).toHaveBeenCalledWith(
        'pipeline-123',
        expect.objectContaining({
          status: PipelineStatus.FAILED,
          failureReason: expect.stringMatching(/Failed to enqueue stage job: queue down/),
          completedAt: expect.any(Date)
        })
      );
    });
  });

  describe('pausePipeline', () => {
    it('pauses a running pipeline and delegates to stage service', async () => {
      pipelineRepository.findOne.mockResolvedValue(makePipeline({ status: PipelineStatus.RUNNING }));
      await service.pausePipeline('pipeline-123', mockUser);
      expect(pipelineRepository.save).toHaveBeenCalledWith(expect.objectContaining({ status: PipelineStatus.PAUSED }));
      expect(stageExecutionService.pauseCurrentStage).toHaveBeenCalled();
    });

    it('throws if pipeline is not running', async () => {
      pipelineRepository.findOne.mockResolvedValue(makePipeline({ status: PipelineStatus.PENDING }));
      await expect(service.pausePipeline('pipeline-123', mockUser)).rejects.toThrow(BadRequestException);
    });
  });

  describe('resumePipeline', () => {
    it('resumes a paused pipeline', async () => {
      pipelineRepository.findOne.mockResolvedValue(makePipeline({ status: PipelineStatus.PAUSED }));
      await service.resumePipeline('pipeline-123', mockUser);
      expect(pipelineRepository.save).toHaveBeenCalledWith(expect.objectContaining({ status: PipelineStatus.RUNNING }));
      expect(stageExecutionService.resumeCurrentStage).toHaveBeenCalled();
    });

    it('throws if pipeline is not paused', async () => {
      pipelineRepository.findOne.mockResolvedValue(makePipeline({ status: PipelineStatus.RUNNING }));
      await expect(service.resumePipeline('pipeline-123', mockUser)).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancelPipeline', () => {
    it('delegates stage cancel and removes queued job', async () => {
      pipelineRepository.findOne.mockResolvedValue(makePipeline({ status: PipelineStatus.RUNNING }));
      await service.cancelPipeline('pipeline-123', mockUser);
      expect(stageExecutionService.cancelCurrentStage).toHaveBeenCalled();
      expect(stageExecutionService.removeStageJob).toHaveBeenCalledWith('pipeline-123', PipelineStage.OPTIMIZE);
    });

    it.each([[PipelineStatus.COMPLETED], [PipelineStatus.CANCELLED]])(
      'throws when pipeline already %s',
      async (status) => {
        pipelineRepository.findOne.mockResolvedValue(makePipeline({ status }));
        await expect(service.cancelPipeline('pipeline-123', mockUser)).rejects.toThrow(BadRequestException);
        expect(stageExecutionService.cancelCurrentStage).not.toHaveBeenCalled();
      }
    );
  });

  describe('skipStage', () => {
    it('cancels current stage and advances', async () => {
      pipelineRepository.findOne.mockResolvedValue(makePipeline({ status: PipelineStatus.RUNNING }));
      await service.skipStage('pipeline-123', mockUser);
      expect(stageExecutionService.cancelCurrentStage).toHaveBeenCalled();
      expect(progressionService.advanceToNextStage).toHaveBeenCalled();
    });

    it('throws if pipeline is not running or paused', async () => {
      pipelineRepository.findOne.mockResolvedValue(makePipeline({ status: PipelineStatus.PENDING }));
      await expect(service.skipStage('pipeline-123', mockUser)).rejects.toThrow(BadRequestException);
    });

    it('throws if already at COMPLETED stage', async () => {
      pipelineRepository.findOne.mockResolvedValue(
        makePipeline({ status: PipelineStatus.RUNNING, currentStage: PipelineStage.COMPLETED })
      );
      await expect(service.skipStage('pipeline-123', mockUser)).rejects.toThrow(BadRequestException);
    });
  });

  describe('deletePipeline', () => {
    it('removes a non-running pipeline', async () => {
      const pipeline = makePipeline({ status: PipelineStatus.PENDING });
      pipelineRepository.findOne.mockResolvedValue(pipeline);
      await service.deletePipeline('pipeline-123', mockUser);
      expect(pipelineRepository.remove).toHaveBeenCalledWith(pipeline);
    });

    it('throws when trying to delete a running pipeline', async () => {
      pipelineRepository.findOne.mockResolvedValue(makePipeline({ status: PipelineStatus.RUNNING }));
      await expect(service.deletePipeline('pipeline-123', mockUser)).rejects.toThrow(BadRequestException);
      expect(pipelineRepository.remove).not.toHaveBeenCalled();
    });
  });

  describe('recordOptimizationSkipped', () => {
    it('persists a skipped optimization result', async () => {
      const pipeline = makePipeline();
      pipelineRepository.findOne.mockResolvedValue(pipeline);
      await service.recordOptimizationSkipped('pipeline-123');
      expect(pipelineRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          stageResults: expect.objectContaining({
            optimization: expect.objectContaining({ runId: 'skipped', status: 'COMPLETED' })
          })
        })
      );
    });

    it('is a no-op when pipeline is missing', async () => {
      pipelineRepository.findOne.mockResolvedValue(null);
      await service.recordOptimizationSkipped('missing');
      expect(pipelineRepository.save).not.toHaveBeenCalled();
    });
  });
});
