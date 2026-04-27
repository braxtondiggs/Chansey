import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { type Repository } from 'typeorm';

import { PipelineProgressionService } from './pipeline-progression.service';
import { PipelineStageExecutionService } from './pipeline-stage-execution.service';

import { MarketRegimeService } from '../../market-regime/market-regime.service';
import { CorrelationScoringService } from '../../scoring/correlation-scoring.service';
import { ScoringService } from '../../scoring/scoring.service';
import { DegradationCalculator } from '../../scoring/walk-forward/degradation.calculator';
import { type User } from '../../users/users.entity';
import { Pipeline } from '../entities/pipeline.entity';
import {
  DEFAULT_PROGRESSION_RULES,
  DeploymentRecommendation,
  PIPELINE_EVENTS,
  PipelineStage,
  PipelineStatus
} from '../interfaces';

describe('PipelineProgressionService', () => {
  let service: PipelineProgressionService;
  let pipelineRepository: jest.Mocked<Repository<Pipeline>>;
  let stageExecutionService: jest.Mocked<PipelineStageExecutionService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let scoringService: jest.Mocked<ScoringService>;
  let marketRegimeService: jest.Mocked<MarketRegimeService>;
  let degradationCalculator: jest.Mocked<DegradationCalculator>;

  const mockUser: User = { id: 'user-123' } as User;

  const basePipeline: Pipeline = {
    id: 'pipeline-123',
    name: 'Test Pipeline',
    status: PipelineStatus.RUNNING,
    currentStage: PipelineStage.OPTIMIZE,
    strategyConfigId: 'strategy-123',
    stageConfig: {
      historical: { startDate: '2023-01-01', endDate: '2024-01-01', initialCapital: 10000 },
      liveReplay: { startDate: '2024-01-01', endDate: '2024-03-01', initialCapital: 10000 },
      paperTrading: { initialCapital: 10000, duration: '7d' }
    },
    progressionRules: DEFAULT_PROGRESSION_RULES,
    stageResults: {},
    user: mockUser
  } as Pipeline;

  const makePipeline = (overrides: Partial<Pipeline> = {}): Pipeline => ({ ...basePipeline, ...overrides }) as Pipeline;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PipelineProgressionService,
        {
          provide: getRepositoryToken(Pipeline),
          useValue: { save: jest.fn() }
        },
        {
          provide: PipelineStageExecutionService,
          useValue: { enqueueStageJob: jest.fn() }
        },
        {
          provide: EventEmitter2,
          useValue: { emit: jest.fn() }
        },
        {
          provide: ScoringService,
          useValue: { calculateScoreFromMetrics: jest.fn() }
        },
        {
          provide: MarketRegimeService,
          useValue: { getCurrentRegime: jest.fn() }
        },
        {
          provide: DegradationCalculator,
          useValue: { calculateFromValues: jest.fn().mockReturnValue(50) }
        },
        {
          provide: CorrelationScoringService,
          useValue: { calculateMaxCorrelation: jest.fn().mockResolvedValue(0) }
        }
      ]
    }).compile();

    service = module.get(PipelineProgressionService);
    pipelineRepository = module.get(getRepositoryToken(Pipeline));
    stageExecutionService = module.get(PipelineStageExecutionService);
    eventEmitter = module.get(EventEmitter2);
    scoringService = module.get(ScoringService);
    marketRegimeService = module.get(MarketRegimeService);
    degradationCalculator = module.get(DegradationCalculator);
  });

  describe('evaluateOptimizationProgression', () => {
    it('passes when improvement meets threshold and bestScore is non-negative', () => {
      const { passed, failures } = service.evaluateOptimizationProgression(
        makePipeline(),
        DEFAULT_PROGRESSION_RULES.optimization.minImprovement,
        10
      );
      expect(passed).toBe(true);
      expect(failures).toHaveLength(0);
    });

    it('passes when bestScore equals the threshold (boundary)', () => {
      const { passed, failures } = service.evaluateOptimizationProgression(
        makePipeline(),
        DEFAULT_PROGRESSION_RULES.optimization.minImprovement,
        0
      );
      expect(passed).toBe(true);
      expect(failures).toHaveLength(0);
    });

    it('fails with only absolute-score reason when bestScore < 0 but improvement is strong', () => {
      const { passed, failures } = service.evaluateOptimizationProgression(makePipeline(), 200, -2);
      expect(passed).toBe(false);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain('Best test score');
      expect(failures[0]).toContain('lost money');
    });

    it('fails with only improvement reason when bestScore is non-negative but improvement is too low', () => {
      const { passed, failures } = service.evaluateOptimizationProgression(makePipeline(), 0, 5);
      expect(passed).toBe(false);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain('Improvement');
    });

    it('fails with both reasons when bestScore < 0 and improvement is too low', () => {
      const { passed, failures } = service.evaluateOptimizationProgression(makePipeline(), 0, -4);
      expect(passed).toBe(false);
      expect(failures).toHaveLength(2);
      expect(failures.some((f) => f.includes('Best test score'))).toBe(true);
      expect(failures.some((f) => f.includes('Improvement'))).toBe(true);
    });

    it('honors a custom minAbsoluteScore override in progressionRules', () => {
      const pipeline = makePipeline({
        progressionRules: {
          ...DEFAULT_PROGRESSION_RULES,
          optimization: { minImprovement: 3, minAbsoluteScore: 20 }
        }
      });
      const { passed, failures } = service.evaluateOptimizationProgression(pipeline, 10, 15);
      expect(passed).toBe(false);
      expect(failures.some((f) => f.includes('Best test score'))).toBe(true);
    });
  });

  describe('evaluateStageProgression', () => {
    const goodMetrics = {
      sharpeRatio: 1.5,
      totalReturn: 0.2,
      maxDrawdown: 0.1,
      winRate: 0.6,
      totalTrades: 50
    };

    it('passes when all metrics meet thresholds', () => {
      const { passed } = service.evaluateStageProgression(goodMetrics, DEFAULT_PROGRESSION_RULES.paperTrading);
      expect(passed).toBe(true);
    });

    it('fails when sharpe ratio is below minimum', () => {
      const { passed, failures } = service.evaluateStageProgression(
        { ...goodMetrics, sharpeRatio: -1 },
        DEFAULT_PROGRESSION_RULES.paperTrading
      );
      expect(passed).toBe(false);
      expect(failures.some((f) => f.includes('Sharpe'))).toBe(true);
    });

    it('fails when drawdown exceeds maximum', () => {
      const { passed, failures } = service.evaluateStageProgression(
        { ...goodMetrics, maxDrawdown: 0.99 },
        DEFAULT_PROGRESSION_RULES.paperTrading
      );
      expect(passed).toBe(false);
      expect(failures.some((f) => f.includes('drawdown'))).toBe(true);
    });

    it('fails when total return is below minimum', () => {
      const { passed, failures } = service.evaluateStageProgression(
        { ...goodMetrics, totalReturn: -0.5 },
        DEFAULT_PROGRESSION_RULES.paperTrading
      );
      expect(passed).toBe(false);
      expect(failures.some((f) => f.includes('return'))).toBe(true);
    });

    it('fails when win rate is below minimum', () => {
      const { passed, failures } = service.evaluateStageProgression(
        { ...goodMetrics, winRate: 0.01 },
        { ...DEFAULT_PROGRESSION_RULES.paperTrading, minWinRate: 0.5 }
      );
      expect(passed).toBe(false);
      expect(failures.some((f) => f.includes('Win rate'))).toBe(true);
    });

    it('fails when total trades is below minimum', () => {
      const { passed, failures } = service.evaluateStageProgression(
        { ...goodMetrics, totalTrades: 1 },
        { ...DEFAULT_PROGRESSION_RULES.paperTrading, minTotalTrades: 30 }
      );
      expect(passed).toBe(false);
      expect(failures.some((f) => f.includes('Total trades'))).toBe(true);
    });

    it('passes when all thresholds are undefined', () => {
      const { passed } = service.evaluateStageProgression(goodMetrics, {});
      expect(passed).toBe(true);
    });
  });

  describe('calculatePipelineScore', () => {
    const metrics = {
      sharpeRatio: 1.2,
      totalReturn: 0.15,
      maxDrawdown: 0.1,
      winRate: 0.55,
      totalTrades: 40,
      profitFactor: 1.8,
      volatility: 0.2
    };

    beforeEach(() => {
      scoringService.calculateScoreFromMetrics.mockReturnValue({
        overallScore: 75,
        grade: 'B',
        componentScores: {},
        warnings: [],
        regimeModifier: 0
      } as never);
    });

    it('delegates degradation to DegradationCalculator and passes result to scoring service', async () => {
      marketRegimeService.getCurrentRegime.mockResolvedValue({ regime: 'BULL' } as never);
      degradationCalculator.calculateFromValues.mockReturnValue(50);
      const pipeline = makePipeline({
        stageResults: {
          historical: { sharpeRatio: 2.0, totalReturn: 0.3, maxDrawdown: 0.05, winRate: 0.7, totalTrades: 60 }
        } as never
      });

      const result = await service.calculatePipelineScore(pipeline, metrics);

      expect(degradationCalculator.calculateFromValues).toHaveBeenCalledWith(
        expect.objectContaining({
          sharpeRatio: { train: 2.0, test: metrics.sharpeRatio },
          totalReturn: { train: 0.3, test: metrics.totalReturn },
          maxDrawdown: { train: 0.05, test: metrics.maxDrawdown },
          winRate: { train: 0.7, test: metrics.winRate }
        })
      );
      expect(result.degradation).toBe(50);
      expect(result.regime).toBe('BULL');
      expect(result.overallScore).toBe(75);
      expect(scoringService.calculateScoreFromMetrics).toHaveBeenCalledWith(
        expect.objectContaining({ calmarRatio: expect.closeTo(1.5) }),
        50,
        { marketRegime: 'BULL', correlationValue: 0 }
      );
    });

    it('falls back to unknown regime when market regime lookup fails and skips degradation when no historical', async () => {
      marketRegimeService.getCurrentRegime.mockRejectedValue(new Error('boom'));
      const pipeline = makePipeline({ stageResults: {} });

      const result = await service.calculatePipelineScore(pipeline, metrics);

      expect(result.regime).toBe('unknown');
      expect(result.degradation).toBe(0);
      expect(degradationCalculator.calculateFromValues).not.toHaveBeenCalled();
      expect(scoringService.calculateScoreFromMetrics).toHaveBeenCalledWith(expect.any(Object), 0, {
        marketRegime: undefined,
        correlationValue: 0
      });
    });

    it('applies half penalty for small negative degradation (-10 → effective 5)', async () => {
      marketRegimeService.getCurrentRegime.mockResolvedValue(null as never);
      degradationCalculator.calculateFromValues.mockReturnValue(-10);
      const pipeline = makePipeline({
        stageResults: {
          historical: { sharpeRatio: 1.0, totalReturn: 0.05, maxDrawdown: 0.1, winRate: 0.5, totalTrades: 30 }
        } as never
      });

      const result = await service.calculatePipelineScore(pipeline, metrics);

      // raw degradation stays in result for debugging
      expect(result.degradation).toBe(-10);
      // effective degradation = abs(-10) * 0.5 = 5
      expect(scoringService.calculateScoreFromMetrics).toHaveBeenCalledWith(expect.any(Object), 5, expect.any(Object));
    });

    it('applies half penalty for large negative degradation (-60 → effective 30)', async () => {
      marketRegimeService.getCurrentRegime.mockResolvedValue(null as never);
      degradationCalculator.calculateFromValues.mockReturnValue(-60);
      const pipeline = makePipeline({
        stageResults: {
          historical: { sharpeRatio: 1.0, totalReturn: 0.05, maxDrawdown: 0.1, winRate: 0.5, totalTrades: 30 }
        } as never
      });

      const result = await service.calculatePipelineScore(pipeline, metrics);

      expect(result.degradation).toBe(-60);
      // effective degradation = abs(-60) * 0.5 = 30
      expect(scoringService.calculateScoreFromMetrics).toHaveBeenCalledWith(expect.any(Object), 30, expect.any(Object));
    });

    it('uses calmarRatio of 0 when drawdown is 0', async () => {
      marketRegimeService.getCurrentRegime.mockResolvedValue({ regime: 'NEUTRAL' } as never);
      const pipeline = makePipeline({ stageResults: {} });

      await service.calculatePipelineScore(pipeline, { ...metrics, maxDrawdown: 0 });

      expect(scoringService.calculateScoreFromMetrics).toHaveBeenCalledWith(
        expect.objectContaining({ calmarRatio: 0 }),
        expect.any(Number),
        expect.any(Object)
      );
    });
  });

  describe('generateRecommendation', () => {
    it('returns DO_NOT_DEPLOY when stageResults is undefined', () => {
      expect(service.generateRecommendation(undefined)).toBe(DeploymentRecommendation.DO_NOT_DEPLOY);
    });

    it('returns DEPLOY when pipeline score >= 70', () => {
      const result = service.generateRecommendation({ scoring: { overallScore: 85 } } as never);
      expect(result).toBe(DeploymentRecommendation.DEPLOY);
    });

    it('returns NEEDS_REVIEW when pipeline score between 30 and 70', () => {
      const result = service.generateRecommendation({ scoring: { overallScore: 50 } } as never);
      expect(result).toBe(DeploymentRecommendation.NEEDS_REVIEW);
    });

    it('returns DO_NOT_DEPLOY when pipeline score < 30', () => {
      const result = service.generateRecommendation({ scoring: { overallScore: 10 } } as never);
      expect(result).toBe(DeploymentRecommendation.DO_NOT_DEPLOY);
    });

    it('returns DO_NOT_DEPLOY when not all stages passed', () => {
      const result = service.generateRecommendation({
        historical: { status: 'COMPLETED' },
        liveReplay: { status: 'FAILED' },
        paperTrading: { status: 'COMPLETED' }
      } as never);
      expect(result).toBe(DeploymentRecommendation.DO_NOT_DEPLOY);
    });

    it('returns DEPLOY for strong metrics with low degradation', () => {
      degradationCalculator.calculateFromValues.mockReturnValue(10);
      const result = service.generateRecommendation({
        historical: { status: 'COMPLETED', sharpeRatio: 1.5, totalReturn: 0.2, maxDrawdown: 0.1, winRate: 0.65 },
        liveReplay: { status: 'COMPLETED' },
        paperTrading: {
          status: 'COMPLETED',
          totalReturn: 0.18,
          sharpeRatio: 1.2,
          maxDrawdown: 0.15,
          winRate: 0.6
        }
      } as never);
      expect(result).toBe(DeploymentRecommendation.DEPLOY);
    });

    it('returns NEEDS_REVIEW for moderate metrics', () => {
      degradationCalculator.calculateFromValues.mockReturnValue(25);
      const result = service.generateRecommendation({
        historical: { status: 'COMPLETED', sharpeRatio: 0.8, totalReturn: 0.15, maxDrawdown: 0.2, winRate: 0.5 },
        liveReplay: { status: 'COMPLETED' },
        paperTrading: {
          status: 'COMPLETED',
          totalReturn: 0.12,
          sharpeRatio: 0.6,
          maxDrawdown: 0.3,
          winRate: 0.45
        }
      } as never);
      expect(result).toBe(DeploymentRecommendation.NEEDS_REVIEW);
    });

    it('returns DO_NOT_DEPLOY for weak metrics', () => {
      degradationCalculator.calculateFromValues.mockReturnValue(80);
      const result = service.generateRecommendation({
        historical: { status: 'COMPLETED', sharpeRatio: 1.5, totalReturn: 0.2, maxDrawdown: 0.1, winRate: 0.65 },
        liveReplay: { status: 'COMPLETED' },
        paperTrading: {
          status: 'COMPLETED',
          totalReturn: 0.01,
          sharpeRatio: 0.2,
          maxDrawdown: 0.5,
          winRate: 0.3
        }
      } as never);
      expect(result).toBe(DeploymentRecommendation.DO_NOT_DEPLOY);
    });

    it('applies half penalty for negative degradation (-15 → effective 7.5, still within DEPLOY threshold)', () => {
      degradationCalculator.calculateFromValues.mockReturnValue(-15);
      const result = service.generateRecommendation({
        historical: { status: 'COMPLETED', sharpeRatio: 1.0, totalReturn: 0.1, maxDrawdown: 0.15, winRate: 0.5 },
        liveReplay: { status: 'COMPLETED' },
        paperTrading: {
          status: 'COMPLETED',
          totalReturn: 0.25,
          sharpeRatio: 1.5,
          maxDrawdown: 0.1,
          winRate: 0.65
        }
      } as never);
      // effective = abs(-15) * 0.5 = 7.5, which is ≤ 20 threshold → DEPLOY
      expect(result).toBe(DeploymentRecommendation.DEPLOY);
    });

    it('accepts STOPPED as a valid paper trading terminal state', () => {
      degradationCalculator.calculateFromValues.mockReturnValue(10);
      const result = service.generateRecommendation({
        historical: { status: 'COMPLETED', sharpeRatio: 1.5, totalReturn: 0.2, maxDrawdown: 0.1, winRate: 0.65 },
        liveReplay: { status: 'COMPLETED' },
        paperTrading: {
          status: 'STOPPED',
          totalReturn: 0.18,
          sharpeRatio: 1.2,
          maxDrawdown: 0.15,
          winRate: 0.6
        }
      } as never);
      expect(result).toBe(DeploymentRecommendation.DEPLOY);
    });
  });

  describe('advanceToNextStage', () => {
    it('advances from OPTIMIZE to HISTORICAL and enqueues job', async () => {
      const pipeline = makePipeline({ currentStage: PipelineStage.OPTIMIZE });
      pipelineRepository.save.mockResolvedValue(pipeline);

      await service.advanceToNextStage(pipeline);

      expect(pipeline.currentStage).toBe(PipelineStage.HISTORICAL);
      expect(pipelineRepository.save).toHaveBeenCalled();
      expect(stageExecutionService.enqueueStageJob).toHaveBeenCalledWith(
        pipeline,
        PipelineStage.HISTORICAL,
        mockUser.id
      );
    });

    it('bumps stageTransitionedAt when advancing', async () => {
      const pipeline = makePipeline({ currentStage: PipelineStage.OPTIMIZE });
      pipelineRepository.save.mockResolvedValue(pipeline);

      const before = Date.now();
      await service.advanceToNextStage(pipeline);
      const after = Date.now();

      expect(pipeline.stageTransitionedAt).toBeInstanceOf(Date);
      const ts = (pipeline.stageTransitionedAt as Date).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it('calls completePipeline when advancing past PAPER_TRADE', async () => {
      const pipeline = makePipeline({ currentStage: PipelineStage.PAPER_TRADE });
      pipelineRepository.save.mockResolvedValue(pipeline);
      jest.spyOn(service, 'completePipeline').mockResolvedValue();

      await service.advanceToNextStage(pipeline);

      expect(service.completePipeline).toHaveBeenCalledWith(pipeline);
    });

    it('emits PIPELINE_STAGE_TRANSITION event', async () => {
      const pipeline = makePipeline({ currentStage: PipelineStage.OPTIMIZE });
      pipelineRepository.save.mockResolvedValue(pipeline);

      await service.advanceToNextStage(pipeline);

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        PIPELINE_EVENTS.PIPELINE_STAGE_TRANSITION,
        expect.objectContaining({
          pipelineId: pipeline.id,
          previousStage: PipelineStage.OPTIMIZE,
          newStage: PipelineStage.HISTORICAL
        })
      );
    });

    it('throws when stage is unknown', async () => {
      const pipeline = makePipeline({ currentStage: 'INVALID_STAGE' as PipelineStage });

      await expect(service.advanceToNextStage(pipeline)).rejects.toThrow(/unknown stage/);
    });

    it('throws when already at COMPLETED stage', async () => {
      const pipeline = makePipeline({ currentStage: PipelineStage.COMPLETED });

      await expect(service.advanceToNextStage(pipeline)).rejects.toThrow(/already at final stage/);
    });

    it('throws when advancing to a non-terminal stage without a user relation', async () => {
      const pipeline = makePipeline({ currentStage: PipelineStage.OPTIMIZE, user: undefined as never });
      pipelineRepository.save.mockResolvedValue(pipeline);

      await expect(service.advanceToNextStage(pipeline)).rejects.toThrow(/missing user relation/);
      expect(stageExecutionService.enqueueStageJob).not.toHaveBeenCalled();
    });
  });

  describe('failPipeline', () => {
    it('marks pipeline as FAILED and emits event', async () => {
      const pipeline = makePipeline();
      pipelineRepository.save.mockResolvedValue(pipeline);

      await service.failPipeline(pipeline, 'test failure');

      expect(pipeline.status).toBe(PipelineStatus.FAILED);
      expect(pipeline.failureReason).toBe('test failure');
      expect(pipeline.recommendation).toBe(DeploymentRecommendation.DO_NOT_DEPLOY);
      expect(eventEmitter.emit).toHaveBeenCalledWith(PIPELINE_EVENTS.PIPELINE_FAILED, expect.any(Object));
    });

    it('does NOT emit PIPELINE_REJECTED', async () => {
      const pipeline = makePipeline();
      pipelineRepository.save.mockResolvedValue(pipeline);

      await service.failPipeline(pipeline, 'infra boom');

      expect(eventEmitter.emit).not.toHaveBeenCalledWith(PIPELINE_EVENTS.PIPELINE_REJECTED, expect.anything());
    });
  });

  describe('rejectPipeline', () => {
    it('marks pipeline as REJECTED with DO_NOT_DEPLOY and persists failureReason', async () => {
      const pipeline = makePipeline();
      pipelineRepository.save.mockResolvedValue(pipeline);

      await service.rejectPipeline(pipeline, 'Optimization improvement 1.5% < min 3%');

      expect(pipeline.status).toBe(PipelineStatus.REJECTED);
      expect(pipeline.failureReason).toBe('Optimization improvement 1.5% < min 3%');
      expect(pipeline.recommendation).toBe(DeploymentRecommendation.DO_NOT_DEPLOY);
      expect(pipeline.completedAt).toBeInstanceOf(Date);
      expect(pipelineRepository.save).toHaveBeenCalledWith(pipeline);
    });

    it('emits PIPELINE_REJECTED with the reason', async () => {
      const pipeline = makePipeline();
      pipelineRepository.save.mockResolvedValue(pipeline);

      await service.rejectPipeline(pipeline, 'zero trades');

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        PIPELINE_EVENTS.PIPELINE_REJECTED,
        expect.objectContaining({
          pipelineId: pipeline.id,
          reason: 'zero trades'
        })
      );
    });

    it('does NOT emit PIPELINE_FAILED (distinct from failPipeline)', async () => {
      const pipeline = makePipeline();
      pipelineRepository.save.mockResolvedValue(pipeline);

      await service.rejectPipeline(pipeline, 'below threshold');

      expect(pipeline.status).not.toBe(PipelineStatus.FAILED);
      expect(eventEmitter.emit).not.toHaveBeenCalledWith(PIPELINE_EVENTS.PIPELINE_FAILED, expect.anything());
    });
  });

  describe('completePipeline', () => {
    it('marks pipeline as COMPLETED and emits event', async () => {
      const pipeline = makePipeline();
      pipelineRepository.save.mockResolvedValue(pipeline);

      await service.completePipeline(pipeline);

      expect(pipeline.status).toBe(PipelineStatus.COMPLETED);
      expect(pipeline.currentStage).toBe(PipelineStage.COMPLETED);
      expect(eventEmitter.emit).toHaveBeenCalledWith(PIPELINE_EVENTS.PIPELINE_COMPLETED, expect.any(Object));
    });

    it('bumps stageTransitionedAt on completion', async () => {
      const pipeline = makePipeline();
      pipelineRepository.save.mockResolvedValue(pipeline);

      const before = Date.now();
      await service.completePipeline(pipeline);
      const after = Date.now();

      expect(pipeline.stageTransitionedAt).toBeInstanceOf(Date);
      const ts = (pipeline.stageTransitionedAt as Date).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it('lifts stageResults.scoring into entity columns when present', async () => {
      const componentScores = { sharpe: 75, calmar: 60 };
      const pipeline = makePipeline({
        stageResults: {
          scoring: {
            overallScore: 65,
            grade: 'C',
            regime: 'normal',
            componentScores,
            regimeModifier: 0,
            degradation: 10,
            warnings: [],
            calculatedAt: '2026-04-27T00:00:00.000Z'
          }
        } as never
      });
      pipelineRepository.save.mockResolvedValue(pipeline);

      await service.completePipeline(pipeline);

      expect(pipeline.pipelineScore).toBe(65);
      expect(pipeline.scoreGrade).toBe('C');
      expect(pipeline.scoringRegime).toBe('normal');
      expect(pipeline.scoreDetails).toEqual(componentScores);
    });

    it('leaves score columns untouched when stageResults.scoring is absent', async () => {
      const pipeline = makePipeline({ stageResults: {} });
      pipelineRepository.save.mockResolvedValue(pipeline);

      await service.completePipeline(pipeline);

      expect(pipeline.pipelineScore).toBeUndefined();
      expect(pipeline.scoreGrade).toBeUndefined();
      expect(pipeline.scoringRegime).toBeUndefined();
      expect(pipeline.scoreDetails).toBeUndefined();
    });
  });

  describe('markInconclusiveAndComplete', () => {
    it('sets recommendation=INCONCLUSIVE_RETRY and clears score/failureReason', async () => {
      const pipeline = makePipeline({
        pipelineScore: 42,
        scoreGrade: 'C',
        failureReason: 'should be cleared'
      });
      pipelineRepository.save.mockResolvedValue(pipeline);

      await service.markInconclusiveAndComplete(pipeline, 'insufficient signals over 5 days');

      expect(pipeline.status).toBe(PipelineStatus.COMPLETED);
      expect(pipeline.currentStage).toBe(PipelineStage.COMPLETED);
      expect(pipeline.recommendation).toBe(DeploymentRecommendation.INCONCLUSIVE_RETRY);
      expect(pipeline.pipelineScore).toBeNull();
      expect(pipeline.scoreGrade).toBeNull();
      expect(pipeline.failureReason).toBeNull();
      expect(pipeline.completedAt).toBeInstanceOf(Date);
    });

    it('emits PIPELINE_COMPLETED with inconclusive flag', async () => {
      const pipeline = makePipeline();
      pipelineRepository.save.mockResolvedValue(pipeline);

      await service.markInconclusiveAndComplete(pipeline, 'starved');

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        PIPELINE_EVENTS.PIPELINE_COMPLETED,
        expect.objectContaining({
          pipelineId: pipeline.id,
          recommendation: DeploymentRecommendation.INCONCLUSIVE_RETRY,
          inconclusive: true
        })
      );
    });

    it('does NOT set status to FAILED (distinct from failPipeline)', async () => {
      const pipeline = makePipeline();
      pipelineRepository.save.mockResolvedValue(pipeline);

      await service.markInconclusiveAndComplete(pipeline, 'starved');

      expect(pipeline.status).not.toBe(PipelineStatus.FAILED);
      expect(eventEmitter.emit).not.toHaveBeenCalledWith(PIPELINE_EVENTS.PIPELINE_FAILED, expect.anything());
    });

    it('bumps stageTransitionedAt on inconclusive completion', async () => {
      const pipeline = makePipeline();
      pipelineRepository.save.mockResolvedValue(pipeline);

      const before = Date.now();
      await service.markInconclusiveAndComplete(pipeline, 'starved');
      const after = Date.now();

      expect(pipeline.stageTransitionedAt).toBeInstanceOf(Date);
      const ts = (pipeline.stageTransitionedAt as Date).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it('keeps score columns null even when stageResults.scoring is populated', async () => {
      const pipeline = makePipeline({
        stageResults: {
          scoring: {
            overallScore: 80,
            grade: 'A',
            regime: 'normal',
            componentScores: { sharpe: 90 },
            regimeModifier: 0,
            degradation: 5,
            warnings: [],
            calculatedAt: '2026-04-27T00:00:00.000Z'
          }
        } as never
      });
      pipelineRepository.save.mockResolvedValue(pipeline);

      await service.markInconclusiveAndComplete(pipeline, 'starved');

      expect(pipeline.pipelineScore).toBeNull();
      expect(pipeline.scoreGrade).toBeNull();
    });
  });
});
