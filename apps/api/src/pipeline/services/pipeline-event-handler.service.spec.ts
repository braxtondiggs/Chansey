import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { type Repository } from 'typeorm';

import { type ComponentScores, StrategyGrade } from '@chansey/api-interfaces';

import { PipelineEventHandlerService } from './pipeline-event-handler.service';
import { PipelineProgressionService } from './pipeline-progression.service';

import { type User } from '../../users/users.entity';
import { Pipeline } from '../entities/pipeline.entity';
import { DEFAULT_PROGRESSION_RULES, PipelineStage, PipelineStatus } from '../interfaces';

describe('PipelineEventHandlerService', () => {
  let service: PipelineEventHandlerService;
  let pipelineRepository: jest.Mocked<Repository<Pipeline>>;
  let progressionService: jest.Mocked<PipelineProgressionService>;

  const mockUser: User = { id: 'user-123' } as User;

  const mockComponentScores: ComponentScores = {
    sharpeRatio: { value: 1.5, score: 70, weight: 0.25, percentile: 65 },
    calmarRatio: { value: 2.0, score: 75, weight: 0.15, percentile: 70 },
    winRate: { value: 0.6, score: 65, weight: 0.1, percentile: 60 },
    profitFactor: { value: 1.8, score: 68, weight: 0.1, percentile: 62 },
    wfaDegradation: { value: 5, score: 80, weight: 0.2, percentile: 75 },
    stability: { value: 0.7, score: 72, weight: 0.1, percentile: 68 },
    correlation: { value: 100, score: 60, weight: 0.1, percentile: 55 }
  };

  const basePipeline: Pipeline = {
    id: 'pipeline-123',
    name: 'Test Pipeline',
    status: PipelineStatus.RUNNING,
    currentStage: PipelineStage.OPTIMIZE,
    optimizationRunId: 'run-123',
    strategyConfigId: 'strategy-123',
    stageConfig: {
      optimization: { maxCombinations: 50, objectiveMetric: 'sharpe' },
      historical: { startDate: '2023-01-01', endDate: '2024-01-01', initialCapital: 10000 },
      liveReplay: { startDate: '2024-01-01', endDate: '2024-03-01', initialCapital: 10000 },
      paperTrading: { initialCapital: 10000, duration: '7d' }
    },
    progressionRules: DEFAULT_PROGRESSION_RULES,
    stageResults: {},
    user: mockUser
  } as unknown as Pipeline;

  const makePipeline = (overrides: Partial<Pipeline> = {}): Pipeline =>
    ({ ...basePipeline, ...overrides }) as unknown as Pipeline;

  const baseMetrics = {
    sharpeRatio: 1.5,
    totalReturn: 0.2,
    maxDrawdown: 0.1,
    winRate: 0.6,
    totalTrades: 50,
    winningTrades: 30,
    losingTrades: 20,
    profitFactor: 1.8,
    volatility: 0.05
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PipelineEventHandlerService,
        {
          provide: getRepositoryToken(Pipeline),
          useValue: { findOne: jest.fn(), save: jest.fn() }
        },
        {
          provide: PipelineProgressionService,
          useValue: {
            evaluateOptimizationProgression: jest.fn(),
            advanceToNextStage: jest.fn(),
            failPipeline: jest.fn(),
            calculatePipelineScore: jest.fn(),
            evaluateStageProgression: jest.fn(),
            completePipeline: jest.fn(),
            markInconclusiveAndComplete: jest.fn()
          }
        }
      ]
    }).compile();

    service = module.get(PipelineEventHandlerService);
    pipelineRepository = module.get(getRepositoryToken(Pipeline));
    progressionService = module.get(PipelineProgressionService);
  });

  describe('handleOptimizationComplete', () => {
    it('is a no-op when no active pipeline found', async () => {
      pipelineRepository.findOne.mockResolvedValue(null);

      await service.handleOptimizationComplete('run-123', 'strategy-123', {}, 80, 10);

      expect(progressionService.advanceToNextStage).not.toHaveBeenCalled();
      expect(progressionService.failPipeline).not.toHaveBeenCalled();
    });

    it('advances pipeline when improvement meets threshold', async () => {
      pipelineRepository.findOne.mockResolvedValue(makePipeline());
      progressionService.evaluateOptimizationProgression.mockReturnValue({ passed: true, failures: [] });

      await service.handleOptimizationComplete('run-123', 'strategy-123', { rsi: 14 }, 80, 10);

      expect(progressionService.advanceToNextStage).toHaveBeenCalled();
      expect(progressionService.failPipeline).not.toHaveBeenCalled();
    });

    it('fails pipeline when improvement is below threshold', async () => {
      pipelineRepository.findOne.mockResolvedValue(makePipeline());
      progressionService.evaluateOptimizationProgression.mockReturnValue({
        passed: false,
        failures: ['Improvement 1.00% < min 3.00%']
      });

      await service.handleOptimizationComplete('run-123', 'strategy-123', {}, 50, 1);

      expect(progressionService.failPipeline).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('Optimization did not meet')
      );
      expect(progressionService.advanceToNextStage).not.toHaveBeenCalled();
    });

    it('passes bestScore to evaluateOptimizationProgression', async () => {
      pipelineRepository.findOne.mockResolvedValue(makePipeline());
      progressionService.evaluateOptimizationProgression.mockReturnValue({ passed: true, failures: [] });

      await service.handleOptimizationComplete('run-123', 'strategy-123', {}, 80, 10);

      expect(progressionService.evaluateOptimizationProgression).toHaveBeenCalledWith(expect.any(Object), 10, 80);
    });

    it('fails pipeline when bestScore is negative (absolute-score gate)', async () => {
      pipelineRepository.findOne.mockResolvedValue(makePipeline());
      progressionService.evaluateOptimizationProgression.mockReturnValue({
        passed: false,
        failures: ['Best test score -4.00 < minimum 0.00 — all tested combinations lost money in walk-forward testing']
      });

      await service.handleOptimizationComplete('run-123', 'strategy-123', { rsi: 14 }, -4, 200);

      expect(progressionService.evaluateOptimizationProgression).toHaveBeenCalledWith(expect.any(Object), 200, -4);
      expect(progressionService.failPipeline).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('Best test score')
      );
      expect(progressionService.advanceToNextStage).not.toHaveBeenCalled();
    });

    it('sets baselineScore to 0 when improvement is -100', async () => {
      pipelineRepository.findOne.mockResolvedValue(makePipeline());
      progressionService.evaluateOptimizationProgression.mockReturnValue({
        passed: false,
        failures: ['below threshold']
      });

      await service.handleOptimizationComplete('run-123', 'strategy-123', {}, 100, -100);

      expect(progressionService.failPipeline).toHaveBeenCalledWith(
        expect.objectContaining({
          stageResults: expect.objectContaining({
            optimization: expect.objectContaining({ baselineScore: 0 })
          })
        }),
        expect.any(String)
      );
    });

    it('persists stage results before evaluating progression so PAUSED completions are not lost', async () => {
      pipelineRepository.findOne.mockResolvedValue(makePipeline());
      progressionService.evaluateOptimizationProgression.mockReturnValue({ passed: true, failures: [] });

      await service.handleOptimizationComplete('run-123', 'strategy-123', {}, 80, 10);

      expect(pipelineRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          stageResults: expect.objectContaining({
            optimization: expect.objectContaining({ status: 'COMPLETED' })
          })
        })
      );
    });

    it('defers advancement when pipeline is PAUSED but still persists results', async () => {
      const paused = makePipeline();
      paused.status = PipelineStatus.PAUSED;
      pipelineRepository.findOne.mockResolvedValue(paused);
      progressionService.evaluateOptimizationProgression.mockReturnValue({ passed: true, failures: [] });

      await service.handleOptimizationComplete('run-123', 'strategy-123', {}, 80, 10);

      expect(pipelineRepository.save).toHaveBeenCalled();
      expect(progressionService.advanceToNextStage).not.toHaveBeenCalled();
      expect(progressionService.failPipeline).not.toHaveBeenCalled();
    });
  });

  describe('handleOptimizationFailed', () => {
    it('fails pipeline with the provided reason', async () => {
      pipelineRepository.findOne.mockResolvedValue(makePipeline());

      await service.handleOptimizationFailed('run-123', 'timeout');

      expect(progressionService.failPipeline).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('timeout')
      );
    });

    it('is a no-op when no active pipeline found', async () => {
      pipelineRepository.findOne.mockResolvedValue(null);

      await service.handleOptimizationFailed('run-123', 'timeout');

      expect(progressionService.failPipeline).not.toHaveBeenCalled();
    });
  });

  describe('handleBacktestFailed', () => {
    it('fails HISTORICAL pipeline with the provided reason', async () => {
      pipelineRepository.findOne.mockResolvedValue(
        makePipeline({ currentStage: PipelineStage.HISTORICAL, historicalBacktestId: 'bt-123' })
      );

      await service.handleBacktestFailed('bt-123', 'HISTORICAL', 'data unavailable');

      expect(progressionService.failPipeline).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('data unavailable')
      );
    });

    it('fails LIVE_REPLAY pipeline with the provided reason', async () => {
      pipelineRepository.findOne.mockResolvedValue(
        makePipeline({ currentStage: PipelineStage.LIVE_REPLAY, liveReplayBacktestId: 'bt-456' })
      );

      await service.handleBacktestFailed('bt-456', 'LIVE_REPLAY', 'timeout');

      expect(progressionService.failPipeline).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('timeout')
      );
    });

    it('is a no-op when no active pipeline found', async () => {
      pipelineRepository.findOne.mockResolvedValue(null);

      await service.handleBacktestFailed('bt-999', 'HISTORICAL', 'some error');

      expect(progressionService.failPipeline).not.toHaveBeenCalled();
    });
  });

  describe('handleBacktestComplete', () => {
    it('fails pipeline when 0 trades produced', async () => {
      pipelineRepository.findOne.mockResolvedValue(
        makePipeline({ currentStage: PipelineStage.HISTORICAL, historicalBacktestId: 'bt-123' })
      );

      await service.handleBacktestComplete('bt-123', 'HISTORICAL', { ...baseMetrics, totalTrades: 0 });

      expect(progressionService.failPipeline).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('0 trades')
      );
      expect(progressionService.advanceToNextStage).not.toHaveBeenCalled();
    });

    it('auto-advances HISTORICAL stage unconditionally', async () => {
      pipelineRepository.findOne.mockResolvedValue(
        makePipeline({ currentStage: PipelineStage.HISTORICAL, historicalBacktestId: 'bt-123' })
      );

      await service.handleBacktestComplete('bt-123', 'HISTORICAL', baseMetrics);

      expect(progressionService.advanceToNextStage).toHaveBeenCalled();
      expect(progressionService.failPipeline).not.toHaveBeenCalled();
    });

    it('is a no-op when no active pipeline found', async () => {
      pipelineRepository.findOne.mockResolvedValue(null);

      await service.handleBacktestComplete('bt-123', 'HISTORICAL', baseMetrics);

      expect(progressionService.advanceToNextStage).not.toHaveBeenCalled();
    });

    it('advances LIVE_REPLAY when score meets minimum', async () => {
      const pipeline = makePipeline({ currentStage: PipelineStage.LIVE_REPLAY, liveReplayBacktestId: 'bt-456' });
      pipelineRepository.findOne.mockResolvedValue(pipeline);
      progressionService.calculatePipelineScore.mockResolvedValue({
        overallScore: 75,
        grade: StrategyGrade.B,
        componentScores: mockComponentScores,
        regimeModifier: 0,
        regime: 'NEUTRAL',
        degradation: 5,
        warnings: [],
        calculatedAt: new Date().toISOString()
      });

      await service.handleBacktestComplete('bt-456', 'LIVE_REPLAY', baseMetrics);

      expect(progressionService.advanceToNextStage).toHaveBeenCalled();
      expect(progressionService.failPipeline).not.toHaveBeenCalled();
    });

    it('fails LIVE_REPLAY when score is below minimum', async () => {
      const pipeline = makePipeline({
        currentStage: PipelineStage.LIVE_REPLAY,
        liveReplayBacktestId: 'bt-456',
        progressionRules: { ...DEFAULT_PROGRESSION_RULES, minimumPipelineScore: 30 }
      });
      pipelineRepository.findOne.mockResolvedValue(pipeline);
      progressionService.calculatePipelineScore.mockResolvedValue({
        overallScore: 20,
        grade: StrategyGrade.F,
        componentScores: mockComponentScores,
        regimeModifier: 0,
        regime: 'NEUTRAL',
        degradation: 50,
        warnings: [],
        calculatedAt: new Date().toISOString()
      });

      await service.handleBacktestComplete('bt-456', 'LIVE_REPLAY', baseMetrics);

      expect(progressionService.failPipeline).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('< minimum 30')
      );
      expect(progressionService.advanceToNextStage).not.toHaveBeenCalled();
    });

    it('persists scoring fields before stage decision so PAUSED completions are not lost', async () => {
      const pipeline = makePipeline({ currentStage: PipelineStage.LIVE_REPLAY, liveReplayBacktestId: 'bt-456' });
      pipelineRepository.findOne.mockResolvedValue(pipeline);
      progressionService.calculatePipelineScore.mockResolvedValue({
        overallScore: 75,
        grade: StrategyGrade.B,
        componentScores: mockComponentScores,
        regimeModifier: 0,
        regime: 'NEUTRAL',
        degradation: 5,
        warnings: [],
        calculatedAt: new Date().toISOString()
      });

      await service.handleBacktestComplete('bt-456', 'LIVE_REPLAY', baseMetrics);

      expect(pipelineRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          pipelineScore: 75,
          stageResults: expect.objectContaining({ scoring: expect.any(Object) })
        })
      );
    });

    it('defers LIVE_REPLAY advancement when pipeline is PAUSED but still persists results', async () => {
      const pipeline = makePipeline({
        currentStage: PipelineStage.LIVE_REPLAY,
        liveReplayBacktestId: 'bt-456',
        status: PipelineStatus.PAUSED
      });
      pipelineRepository.findOne.mockResolvedValue(pipeline);
      progressionService.calculatePipelineScore.mockResolvedValue({
        overallScore: 75,
        grade: StrategyGrade.B,
        componentScores: mockComponentScores,
        regimeModifier: 0,
        regime: 'NEUTRAL',
        degradation: 5,
        warnings: [],
        calculatedAt: new Date().toISOString()
      });

      await service.handleBacktestComplete('bt-456', 'LIVE_REPLAY', baseMetrics);

      expect(pipelineRepository.save).toHaveBeenCalled();
      expect(progressionService.advanceToNextStage).not.toHaveBeenCalled();
      expect(progressionService.failPipeline).not.toHaveBeenCalled();
    });

    it('defers HISTORICAL advancement when pipeline is PAUSED but still persists results', async () => {
      const pipeline = makePipeline({
        currentStage: PipelineStage.HISTORICAL,
        historicalBacktestId: 'bt-123',
        status: PipelineStatus.PAUSED
      });
      pipelineRepository.findOne.mockResolvedValue(pipeline);

      await service.handleBacktestComplete('bt-123', 'HISTORICAL', baseMetrics);

      expect(pipelineRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          stageResults: expect.objectContaining({ historical: expect.any(Object) })
        })
      );
      expect(progressionService.advanceToNextStage).not.toHaveBeenCalled();
    });
  });

  describe('handlePaperTradingFailed', () => {
    it('fails pipeline with the provided reason', async () => {
      pipelineRepository.findOne.mockResolvedValue(makePipeline({ currentStage: PipelineStage.PAPER_TRADE }));

      await service.handlePaperTradingFailed('session-123', 'pipeline-123', 'out of funds');

      expect(progressionService.failPipeline).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('out of funds')
      );
    });

    it('is a no-op when no active pipeline found', async () => {
      pipelineRepository.findOne.mockResolvedValue(null);

      await service.handlePaperTradingFailed('session-123', 'pipeline-123', 'out of funds');

      expect(progressionService.failPipeline).not.toHaveBeenCalled();
    });
  });

  describe('handlePaperTradingComplete', () => {
    const paperMetrics = {
      initialCapital: 10000,
      currentPortfolioValue: 11000,
      totalReturn: 0.1,
      totalReturnPercent: 10,
      maxDrawdown: 0.05,
      sharpeRatio: 1.2,
      winRate: 0.55,
      totalTrades: 30,
      winningTrades: 16,
      losingTrades: 14,
      totalFees: 50,
      durationHours: 168
    };

    it('completes pipeline when thresholds are met', async () => {
      const pipeline = makePipeline({ currentStage: PipelineStage.PAPER_TRADE });
      pipelineRepository.findOne.mockResolvedValue(pipeline);
      progressionService.evaluateStageProgression.mockReturnValue({ passed: true, failures: [] });

      await service.handlePaperTradingComplete('session-123', 'pipeline-123', paperMetrics, 'duration_reached');

      expect(progressionService.completePipeline).toHaveBeenCalled();
      expect(progressionService.failPipeline).not.toHaveBeenCalled();
    });

    it('fails pipeline when thresholds are not met', async () => {
      const pipeline = makePipeline({ currentStage: PipelineStage.PAPER_TRADE });
      pipelineRepository.findOne.mockResolvedValue(pipeline);
      progressionService.evaluateStageProgression.mockReturnValue({
        passed: false,
        failures: ['Sharpe ratio 0.100 < min 0.300']
      });

      await service.handlePaperTradingComplete('session-123', 'pipeline-123', { ...paperMetrics, sharpeRatio: 0.1 });

      expect(progressionService.failPipeline).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('Paper trading did not meet thresholds')
      );
      expect(progressionService.completePipeline).not.toHaveBeenCalled();
    });

    it('is a no-op when pipeline not found', async () => {
      pipelineRepository.findOne.mockResolvedValue(null);

      await service.handlePaperTradingComplete('session-123', 'missing-id', paperMetrics);

      expect(progressionService.completePipeline).not.toHaveBeenCalled();
      expect(progressionService.failPipeline).not.toHaveBeenCalled();
    });

    it('persists stage results before evaluating thresholds so PAUSED completions are not lost', async () => {
      const pipeline = makePipeline({ currentStage: PipelineStage.PAPER_TRADE });
      pipelineRepository.findOne.mockResolvedValue(pipeline);
      progressionService.evaluateStageProgression.mockReturnValue({ passed: true, failures: [] });

      await service.handlePaperTradingComplete('session-123', 'pipeline-123', paperMetrics, 'duration_reached');

      expect(pipelineRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          stageResults: expect.objectContaining({ paperTrading: expect.any(Object) })
        })
      );
    });

    it('defers completion when pipeline is PAUSED but still persists results', async () => {
      const pipeline = makePipeline({ currentStage: PipelineStage.PAPER_TRADE, status: PipelineStatus.PAUSED });
      pipelineRepository.findOne.mockResolvedValue(pipeline);
      progressionService.evaluateStageProgression.mockReturnValue({ passed: true, failures: [] });

      await service.handlePaperTradingComplete('session-123', 'pipeline-123', paperMetrics, 'duration_reached');

      expect(pipelineRepository.save).toHaveBeenCalled();
      expect(progressionService.completePipeline).not.toHaveBeenCalled();
      expect(progressionService.failPipeline).not.toHaveBeenCalled();
    });

    it.each(['target_reached', 'min_trades_reached'] as const)(
      'completes pipeline for stoppedReason "%s"',
      async (stoppedReason) => {
        const pipeline = makePipeline({ currentStage: PipelineStage.PAPER_TRADE });
        pipelineRepository.findOne.mockResolvedValue(pipeline);
        progressionService.evaluateStageProgression.mockReturnValue({ passed: true, failures: [] });

        await service.handlePaperTradingComplete('session-123', 'pipeline-123', paperMetrics, stoppedReason);

        expect(progressionService.completePipeline).toHaveBeenCalled();
      }
    );

    it('records STOPPED status when stoppedReason is not a completion reason', async () => {
      const pipeline = makePipeline({ currentStage: PipelineStage.PAPER_TRADE });
      pipelineRepository.findOne.mockResolvedValue(pipeline);
      progressionService.evaluateStageProgression.mockReturnValue({ passed: true, failures: [] });

      await service.handlePaperTradingComplete('session-123', 'pipeline-123', paperMetrics, undefined);

      expect(progressionService.completePipeline).toHaveBeenCalledWith(
        expect.objectContaining({
          stageResults: expect.objectContaining({
            paperTrading: expect.objectContaining({ status: 'STOPPED' })
          })
        })
      );
    });

    describe('insufficient_signals early termination', () => {
      it('routes to markInconclusiveAndComplete (not failPipeline) when stoppedReason=insufficient_signals', async () => {
        const pipeline = makePipeline({ currentStage: PipelineStage.PAPER_TRADE });
        pipelineRepository.findOne.mockResolvedValue(pipeline);

        await service.handlePaperTradingComplete(
          'session-123',
          'pipeline-123',
          { ...paperMetrics, totalTrades: 0 },
          'insufficient_signals'
        );

        expect(progressionService.markInconclusiveAndComplete).toHaveBeenCalledWith(
          pipeline,
          expect.stringContaining('insufficient signals')
        );
        expect(progressionService.failPipeline).not.toHaveBeenCalled();
        expect(progressionService.completePipeline).not.toHaveBeenCalled();
      });

      it('records paperTrading.status as COMPLETED (not STOPPED) for insufficient_signals', async () => {
        const pipeline = makePipeline({ currentStage: PipelineStage.PAPER_TRADE });
        pipelineRepository.findOne.mockResolvedValue(pipeline);

        await service.handlePaperTradingComplete(
          'session-123',
          'pipeline-123',
          { ...paperMetrics, totalTrades: 0 },
          'insufficient_signals'
        );

        expect(pipelineRepository.save).toHaveBeenCalledWith(
          expect.objectContaining({
            stageResults: expect.objectContaining({
              paperTrading: expect.objectContaining({ status: 'COMPLETED' })
            })
          })
        );
      });

      it('does not evaluate progression thresholds for insufficient_signals', async () => {
        const pipeline = makePipeline({ currentStage: PipelineStage.PAPER_TRADE });
        pipelineRepository.findOne.mockResolvedValue(pipeline);

        await service.handlePaperTradingComplete(
          'session-123',
          'pipeline-123',
          { ...paperMetrics, totalTrades: 0 },
          'insufficient_signals'
        );

        expect(progressionService.evaluateStageProgression).not.toHaveBeenCalled();
      });
    });
  });
});
