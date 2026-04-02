import { getQueueToken } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { BacktestWatchdogService } from './backtest-watchdog.service';

import { OptimizationRun, OptimizationStatus } from '../optimization/entities/optimization-run.entity';
import { BacktestResultService } from '../order/backtest/backtest-result.service';
import { backtestConfig } from '../order/backtest/backtest.config';
import { Backtest, BacktestStatus, BacktestType } from '../order/backtest/backtest.entity';
import { Pipeline } from '../pipeline/entities/pipeline.entity';
import { PIPELINE_EVENTS, PipelineStage, PipelineStatus } from '../pipeline/interfaces';

const BACKTEST_QUEUE_NAMES = backtestConfig();

describe('BacktestWatchdogService', () => {
  let service: BacktestWatchdogService;

  const mockHistoricalQueue = { getJob: jest.fn() };
  const mockReplayQueue = { getJob: jest.fn() };
  const mockOptimizationQueue = { getJob: jest.fn() };

  const mockBacktestResultService = {
    markFailed: jest.fn().mockResolvedValue(undefined)
  };

  const mockBacktestRepository = {
    find: jest.fn().mockResolvedValue([])
  };

  const mockOptimizationRunRepository = {
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue(undefined)
  };

  const mockPipelineRepository = {
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue(undefined)
  };

  const mockEventEmitter = {
    emit: jest.fn()
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BacktestWatchdogService,
        { provide: getQueueToken(BACKTEST_QUEUE_NAMES.historicalQueue), useValue: mockHistoricalQueue },
        { provide: getQueueToken(BACKTEST_QUEUE_NAMES.replayQueue), useValue: mockReplayQueue },
        { provide: getQueueToken('optimization'), useValue: mockOptimizationQueue },
        { provide: BacktestResultService, useValue: mockBacktestResultService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: getRepositoryToken(Backtest), useValue: mockBacktestRepository },
        { provide: getRepositoryToken(OptimizationRun), useValue: mockOptimizationRunRepository },
        { provide: getRepositoryToken(Pipeline), useValue: mockPipelineRepository }
      ]
    }).compile();

    service = module.get<BacktestWatchdogService>(BacktestWatchdogService);

    // Pretend boot happened long ago so existing tests bypass the grace period
    (service as any).bootedAt = 0;

    jest.clearAllMocks();
  });

  describe('detectStaleBacktests — boot grace period', () => {
    it('should skip stale detection during boot grace period', async () => {
      (service as any).bootedAt = Date.now(); // just booted

      await service.detectStaleBacktests();

      expect(mockBacktestRepository.find).not.toHaveBeenCalled();
      expect(mockBacktestResultService.markFailed).not.toHaveBeenCalled();
    });

    it('should run stale detection after boot grace period', async () => {
      (service as any).bootedAt = Date.now() - 11 * 60 * 1000; // 11 min ago
      mockBacktestRepository.find.mockResolvedValue([]);

      await service.detectStaleBacktests();

      expect(mockBacktestRepository.find).toHaveBeenCalledTimes(3);
    });
  });

  describe('detectStaleBacktests', () => {
    it('should do nothing when no stale backtests exist', async () => {
      mockBacktestRepository.find.mockResolvedValue([]);

      await service.detectStaleBacktests();

      // Three find calls: HISTORICAL, LIVE_REPLAY, PENDING
      expect(mockBacktestRepository.find).toHaveBeenCalledTimes(3);
      expect(mockBacktestResultService.markFailed).not.toHaveBeenCalled();
    });

    it('should mark stale HISTORICAL backtests as failed with 90-min threshold', async () => {
      const staleBacktest = {
        id: 'stale-bt-1',
        type: BacktestType.HISTORICAL,
        status: BacktestStatus.RUNNING,
        lastCheckpointAt: new Date(Date.now() - 100 * 60 * 1000),
        processedTimestampCount: 500,
        totalTimestampCount: 2000,
        checkpointState: { lastProcessedIndex: 499 }
      };
      mockBacktestRepository.find
        .mockResolvedValueOnce([staleBacktest])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await service.detectStaleBacktests();

      expect(mockBacktestResultService.markFailed).toHaveBeenCalledWith(
        'stale-bt-1',
        expect.stringContaining('Stale: no heartbeat progress for 90 min')
      );
    });

    it('should mark stale LIVE_REPLAY backtests as failed with 120-min threshold', async () => {
      const staleReplay = {
        id: 'stale-replay-1',
        type: BacktestType.LIVE_REPLAY,
        status: BacktestStatus.RUNNING,
        lastCheckpointAt: new Date(Date.now() - 130 * 60 * 1000),
        processedTimestampCount: 200,
        totalTimestampCount: 1000,
        checkpointState: { lastProcessedIndex: 199 }
      };
      mockBacktestRepository.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([staleReplay])
        .mockResolvedValueOnce([]);

      await service.detectStaleBacktests();

      expect(mockBacktestResultService.markFailed).toHaveBeenCalledWith(
        'stale-replay-1',
        expect.stringContaining('Stale: no heartbeat progress for 120 min')
      );
    });

    it('should continue loop when markFailed throws for one backtest', async () => {
      const stale1 = {
        id: 'stale-1',
        type: BacktestType.HISTORICAL,
        status: BacktestStatus.RUNNING,
        lastCheckpointAt: new Date(Date.now() - 100 * 60 * 1000),
        processedTimestampCount: 100,
        totalTimestampCount: 500,
        checkpointState: { lastProcessedIndex: 99 }
      };
      const stale2 = {
        id: 'stale-2',
        type: BacktestType.HISTORICAL,
        status: BacktestStatus.RUNNING,
        lastCheckpointAt: new Date(Date.now() - 110 * 60 * 1000),
        processedTimestampCount: 200,
        totalTimestampCount: 600,
        checkpointState: { lastProcessedIndex: 199 }
      };
      mockBacktestRepository.find
        .mockResolvedValueOnce([stale1, stale2])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      mockBacktestResultService.markFailed
        .mockRejectedValueOnce(new Error('DB connection lost'))
        .mockResolvedValueOnce(undefined);

      await service.detectStaleBacktests();

      expect(mockBacktestResultService.markFailed).toHaveBeenCalledTimes(2);
      expect(mockBacktestResultService.markFailed).toHaveBeenCalledWith('stale-1', expect.any(String));
      expect(mockBacktestResultService.markFailed).toHaveBeenCalledWith('stale-2', expect.any(String));
    });

    it('should mark stuck PENDING backtests as failed with 30-min threshold', async () => {
      const stuckPending = {
        id: 'pending-bt-1',
        type: BacktestType.HISTORICAL,
        status: BacktestStatus.PENDING,
        updatedAt: new Date(Date.now() - 45 * 60 * 1000),
        processedTimestampCount: 0,
        totalTimestampCount: 0,
        checkpointState: null
      };
      mockBacktestRepository.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([stuckPending]);
      mockHistoricalQueue.getJob.mockResolvedValue(null);

      await service.detectStaleBacktests();

      expect(mockBacktestResultService.markFailed).toHaveBeenCalledWith(
        'pending-bt-1',
        expect.stringContaining('Stuck PENDING for 30 min')
      );
    });

    it.each([
      { type: BacktestType.HISTORICAL, state: 'waiting', queue: 'historical' },
      { type: BacktestType.HISTORICAL, state: 'active', queue: 'historical' },
      { type: BacktestType.LIVE_REPLAY, state: 'delayed', queue: 'replay' }
    ])('should skip PENDING $type backtest when BullMQ job is in $state state', async ({ type, state, queue }) => {
      const stuckPending = {
        id: 'pending-bt-queued',
        type,
        status: BacktestStatus.PENDING,
        updatedAt: new Date(Date.now() - 45 * 60 * 1000),
        processedTimestampCount: 0,
        totalTimestampCount: 0,
        checkpointState: null
      };
      mockBacktestRepository.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([stuckPending]);
      const mockQueue = queue === 'historical' ? mockHistoricalQueue : mockReplayQueue;
      mockQueue.getJob.mockResolvedValue({ getState: jest.fn().mockResolvedValue(state) });

      await service.detectStaleBacktests();

      expect(mockBacktestResultService.markFailed).not.toHaveBeenCalled();
    });

    it('should still mark PENDING backtest as FAILED when queue check errors', async () => {
      const stuckPending = {
        id: 'pending-bt-4',
        type: BacktestType.HISTORICAL,
        status: BacktestStatus.PENDING,
        updatedAt: new Date(Date.now() - 45 * 60 * 1000),
        processedTimestampCount: 0,
        totalTimestampCount: 0,
        checkpointState: null
      };
      mockBacktestRepository.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([stuckPending]);
      mockHistoricalQueue.getJob.mockRejectedValue(new Error('Redis connection lost'));

      await service.detectStaleBacktests();

      expect(mockBacktestResultService.markFailed).toHaveBeenCalledWith(
        'pending-bt-4',
        expect.stringContaining('Stuck PENDING for 30 min')
      );
    });
  });

  describe('detectStaleOptimizationRuns — boot grace period', () => {
    it('should skip stale detection during boot grace period', async () => {
      (service as any).bootedAt = Date.now();

      await service.detectStaleOptimizationRuns();

      expect(mockOptimizationRunRepository.find).not.toHaveBeenCalled();
    });
  });

  describe('detectStaleOptimizationRuns — queue-aware PENDING check', () => {
    it('should skip PENDING optimization run when BullMQ job is in waiting state', async () => {
      const pendingRun = {
        id: 'opt-run-1',
        status: OptimizationStatus.PENDING,
        createdAt: new Date(Date.now() - 400 * 60 * 1000),
        combinationsTested: 0,
        totalCombinations: 100
      };
      mockOptimizationRunRepository.find.mockResolvedValue([pendingRun]);
      mockOptimizationQueue.getJob.mockResolvedValue({ getState: jest.fn().mockResolvedValue('waiting') });

      await service.detectStaleOptimizationRuns();

      expect(mockOptimizationRunRepository.update).not.toHaveBeenCalled();
    });

    it('should still mark PENDING optimization run as FAILED when BullMQ job is missing', async () => {
      const pendingRun = {
        id: 'opt-run-2',
        status: OptimizationStatus.PENDING,
        createdAt: new Date(Date.now() - 400 * 60 * 1000),
        combinationsTested: 0,
        totalCombinations: 100
      };
      mockOptimizationRunRepository.find.mockResolvedValue([pendingRun]);
      mockOptimizationQueue.getJob.mockResolvedValue(null);
      mockOptimizationRunRepository.update.mockResolvedValue({ affected: 1 });

      await service.detectStaleOptimizationRuns();

      expect(mockOptimizationRunRepository.update).toHaveBeenCalledWith(
        { id: 'opt-run-2', status: expect.anything() },
        expect.objectContaining({
          status: OptimizationStatus.FAILED,
          errorMessage: expect.stringContaining('PENDING')
        })
      );
    });

    it('should still mark PENDING optimization run as FAILED when queue check errors', async () => {
      const pendingRun = {
        id: 'opt-run-3',
        status: OptimizationStatus.PENDING,
        createdAt: new Date(Date.now() - 400 * 60 * 1000),
        combinationsTested: 0,
        totalCombinations: 100
      };
      mockOptimizationRunRepository.find.mockResolvedValue([pendingRun]);
      mockOptimizationQueue.getJob.mockRejectedValue(new Error('Redis timeout'));
      mockOptimizationRunRepository.update.mockResolvedValue({ affected: 1 });

      await service.detectStaleOptimizationRuns();

      expect(mockOptimizationRunRepository.update).toHaveBeenCalledWith(
        { id: 'opt-run-3', status: expect.anything() },
        expect.objectContaining({
          status: OptimizationStatus.FAILED
        })
      );
    });

    it('should emit OPTIMIZATION_FAILED event when marking stale run', async () => {
      const staleRun = {
        id: 'opt-run-stale',
        status: OptimizationStatus.RUNNING,
        lastHeartbeatAt: new Date(Date.now() - 400 * 60 * 1000),
        startedAt: new Date(Date.now() - 500 * 60 * 1000),
        combinationsTested: 50,
        totalCombinations: 100
      };
      mockOptimizationRunRepository.find.mockResolvedValue([staleRun]);
      mockOptimizationRunRepository.update.mockResolvedValue({ affected: 1 });

      await service.detectStaleOptimizationRuns();

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(PIPELINE_EVENTS.OPTIMIZATION_FAILED, {
        runId: 'opt-run-stale',
        reason: expect.stringContaining('no heartbeat for 360 min')
      });
    });

    it('should skip event emission when optimization run already transitioned', async () => {
      const staleRun = {
        id: 'opt-run-transitioned',
        status: OptimizationStatus.RUNNING,
        lastHeartbeatAt: new Date(Date.now() - 400 * 60 * 1000),
        startedAt: new Date(Date.now() - 500 * 60 * 1000),
        combinationsTested: 50,
        totalCombinations: 100
      };
      mockOptimizationRunRepository.find.mockResolvedValue([staleRun]);
      mockOptimizationRunRepository.update.mockResolvedValue({ affected: 0 });

      await service.detectStaleOptimizationRuns();

      expect(mockOptimizationRunRepository.update).toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('detectOrphanedOptimizePipelines', () => {
    it('should do nothing when no orphaned pipelines exist', async () => {
      mockPipelineRepository.find.mockResolvedValue([]);

      await service.detectOrphanedOptimizePipelines();

      expect(mockPipelineRepository.update).not.toHaveBeenCalled();
    });

    it('should mark orphaned pipeline as FAILED', async () => {
      const orphaned = {
        id: 'pipeline-orphan-1',
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.OPTIMIZE,
        optimizationRunId: null,
        updatedAt: new Date(Date.now() - 400 * 60 * 1000)
      };
      mockPipelineRepository.find.mockResolvedValue([orphaned]);
      mockPipelineRepository.update.mockResolvedValue({ affected: 1 });

      await service.detectOrphanedOptimizePipelines();

      expect(mockPipelineRepository.update).toHaveBeenCalledWith(
        { id: 'pipeline-orphan-1', status: PipelineStatus.RUNNING },
        expect.objectContaining({
          status: PipelineStatus.FAILED,
          failureReason: 'Orphaned: optimization never started'
        })
      );
    });

    it('should skip pipeline that already transitioned', async () => {
      const orphaned = {
        id: 'pipeline-orphan-2',
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.OPTIMIZE,
        optimizationRunId: null,
        updatedAt: new Date(Date.now() - 400 * 60 * 1000)
      };
      mockPipelineRepository.find.mockResolvedValue([orphaned]);
      mockPipelineRepository.update.mockResolvedValue({ affected: 0 });

      await service.detectOrphanedOptimizePipelines();

      expect(mockPipelineRepository.update).toHaveBeenCalledTimes(1);
    });

    it('should skip during boot grace period', async () => {
      (service as any).bootedAt = Date.now();

      await service.detectOrphanedOptimizePipelines();

      expect(mockPipelineRepository.find).not.toHaveBeenCalled();
    });
  });

  describe('detectFailedOptimizationPipelines', () => {
    it('should do nothing when no candidates exist', async () => {
      mockPipelineRepository.find.mockResolvedValue([]);

      await service.detectFailedOptimizationPipelines();

      expect(mockPipelineRepository.update).not.toHaveBeenCalled();
    });

    it('should mark pipeline as FAILED when optimization run is FAILED', async () => {
      const pipeline = {
        id: 'pipeline-fail-1',
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.OPTIMIZE,
        optimizationRunId: 'opt-run-failed'
      };
      const failedRun = {
        id: 'opt-run-failed',
        status: OptimizationStatus.FAILED,
        errorMessage: 'Out of memory'
      };
      mockPipelineRepository.find.mockResolvedValue([pipeline]);
      mockOptimizationRunRepository.find.mockResolvedValue([failedRun]);
      mockPipelineRepository.update.mockResolvedValue({ affected: 1 });

      await service.detectFailedOptimizationPipelines();

      expect(mockPipelineRepository.update).toHaveBeenCalledWith(
        { id: 'pipeline-fail-1', status: PipelineStatus.RUNNING },
        expect.objectContaining({
          status: PipelineStatus.FAILED,
          failureReason: expect.stringContaining('Out of memory')
        })
      );
    });

    it('should mark pipeline as FAILED when optimization run no longer exists', async () => {
      const pipeline = {
        id: 'pipeline-fail-2',
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.OPTIMIZE,
        optimizationRunId: 'opt-run-deleted'
      };
      mockPipelineRepository.find.mockResolvedValue([pipeline]);
      mockOptimizationRunRepository.find.mockResolvedValue([]); // run deleted
      mockPipelineRepository.update.mockResolvedValue({ affected: 1 });

      await service.detectFailedOptimizationPipelines();

      expect(mockPipelineRepository.update).toHaveBeenCalledWith(
        { id: 'pipeline-fail-2', status: PipelineStatus.RUNNING },
        expect.objectContaining({
          status: PipelineStatus.FAILED,
          failureReason: expect.stringContaining('no longer exists')
        })
      );
    });

    it('should skip pipeline when optimization run is still RUNNING', async () => {
      const pipeline = {
        id: 'pipeline-ok-1',
        status: PipelineStatus.RUNNING,
        currentStage: PipelineStage.OPTIMIZE,
        optimizationRunId: 'opt-run-running'
      };
      const runningRun = {
        id: 'opt-run-running',
        status: OptimizationStatus.RUNNING,
        errorMessage: null
      };
      mockPipelineRepository.find.mockResolvedValue([pipeline]);
      mockOptimizationRunRepository.find.mockResolvedValue([runningRun]);

      await service.detectFailedOptimizationPipelines();

      expect(mockPipelineRepository.update).not.toHaveBeenCalled();
    });

    it('should skip during boot grace period', async () => {
      (service as any).bootedAt = Date.now();

      await service.detectFailedOptimizationPipelines();

      expect(mockPipelineRepository.find).not.toHaveBeenCalled();
    });
  });
});
