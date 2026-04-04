import { Job } from 'bullmq';

import { PaperTradingStatus } from './entities';
import { PaperTradingJobType } from './paper-trading.job-data';
import { PaperTradingProcessor } from './paper-trading.processor';

describe('PaperTradingProcessor', () => {
  const createJob = (data: any): Job<any> => ({ id: 'job-1', data }) as Job<any>;

  const createProcessor = (overrides: Partial<any> = {}) => {
    const sessionRepository = {
      findOne: jest.fn(),
      save: jest.fn()
    };

    const exchangeKeyRepository = {};

    const paperTradingService = {
      scheduleTickJob: jest.fn(),
      removeTickJobs: jest.fn(),
      scheduleRetryTick: jest.fn(),
      markFailed: jest.fn(),
      markCompleted: jest.fn()
    };

    const engineService = {
      processTick: jest.fn(),
      calculateSessionMetrics: jest.fn(),
      clearThrottleState: jest.fn(),
      clearExitTracker: jest.fn(),
      hasThrottleState: jest.fn().mockReturnValue(false),
      restoreThrottleState: jest.fn(),
      getSerializedThrottleState: jest.fn().mockReturnValue(undefined),
      getSerializedExitTrackerState: jest.fn().mockReturnValue(undefined)
    };

    const streamService = {
      publishStatus: jest.fn(),
      publishLog: jest.fn(),
      publishTick: jest.fn(),
      publishMetric: jest.fn()
    };

    const metricsService = {
      startBacktestTimer: jest.fn().mockReturnValue(jest.fn()),
      recordBacktestFinalMetrics: jest.fn()
    };

    const eventEmitter = {
      emit: jest.fn()
    };

    const config = { maxConsecutiveErrors: 2, maxRetryAttempts: 3, retryBackoffMs: 1000 };

    return {
      processor: new PaperTradingProcessor(
        (overrides.config ?? config) as any,
        (overrides.sessionRepository ?? sessionRepository) as any,
        (overrides.exchangeKeyRepository ?? exchangeKeyRepository) as any,
        (overrides.paperTradingService ?? paperTradingService) as any,
        (overrides.engineService ?? engineService) as any,
        (overrides.streamService ?? streamService) as any,
        (overrides.metricsService ?? metricsService) as any,
        (overrides.eventEmitter ?? eventEmitter) as any
      ),
      sessionRepository,
      paperTradingService,
      engineService,
      streamService,
      metricsService,
      eventEmitter
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts active session and schedules ticks', async () => {
    const session = {
      id: 'session-1',
      status: PaperTradingStatus.ACTIVE,
      initialCapital: 1000,
      tickIntervalMs: 30000,
      startedAt: new Date()
    };

    const { processor, sessionRepository, paperTradingService, streamService } = createProcessor();
    sessionRepository.findOne.mockResolvedValue(session);

    const job = createJob({
      type: PaperTradingJobType.START_SESSION,
      sessionId: 'session-1',
      userId: 'user-1'
    });

    await processor.process(job);

    expect(sessionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        currentPortfolioValue: 1000,
        peakPortfolioValue: 1000,
        maxDrawdown: 0,
        totalReturn: 0
      })
    );
    expect(streamService.publishStatus).toHaveBeenCalledWith('session-1', 'active', undefined, {
      startedAt: session.startedAt?.toISOString()
    });
    expect(paperTradingService.scheduleTickJob).toHaveBeenCalledWith('session-1', 'user-1', 30000);
  });

  it('schedules retry with backoff on consecutive errors instead of immediate pause', async () => {
    const session = {
      id: 'session-2',
      status: PaperTradingStatus.ACTIVE,
      initialCapital: 1000,
      tickIntervalMs: 1000,
      consecutiveErrors: 1,
      retryAttempts: 0,
      peakPortfolioValue: 1000,
      user: { id: 'user-2' }
    };

    const { processor, sessionRepository, paperTradingService, engineService, streamService, metricsService } =
      createProcessor();

    sessionRepository.findOne.mockResolvedValue(session);
    engineService.processTick.mockResolvedValue({
      processed: false,
      signalsReceived: 0,
      ordersExecuted: 0,
      errors: ['timeout'],
      portfolioValue: 900,
      prices: {}
    });

    const job = createJob({
      type: PaperTradingJobType.TICK,
      sessionId: 'session-2',
      userId: 'user-2'
    });

    await processor.process(job);

    // Should NOT permanently pause — should schedule retry instead
    expect(session.status).toBe(PaperTradingStatus.ACTIVE);
    expect(session.retryAttempts).toBe(1);
    expect(session.consecutiveErrors).toBe(0);
    expect(paperTradingService.removeTickJobs).toHaveBeenCalledWith('session-2');
    expect(paperTradingService.scheduleRetryTick).toHaveBeenCalledWith('session-2', 'user-2', 1000, 1);
    expect(streamService.publishStatus).toHaveBeenCalledWith(
      'session-2',
      'retry_scheduled',
      'consecutive_errors',
      expect.objectContaining({ retryAttempt: 1, delayMs: 1000 })
    );

    const endTimer = metricsService.startBacktestTimer.mock.results[0].value;
    expect(endTimer).toHaveBeenCalled();
  });

  it('permanently pauses after exhausting retry attempts', async () => {
    const session = {
      id: 'session-2b',
      status: PaperTradingStatus.ACTIVE,
      initialCapital: 1000,
      tickIntervalMs: 1000,
      consecutiveErrors: 1,
      retryAttempts: 3, // Already at maxRetryAttempts (3)
      peakPortfolioValue: 1000,
      user: { id: 'user-2' }
    };

    const { processor, sessionRepository, paperTradingService, engineService, streamService, metricsService } =
      createProcessor();

    sessionRepository.findOne.mockResolvedValue(session);
    engineService.processTick.mockResolvedValue({
      processed: false,
      signalsReceived: 0,
      ordersExecuted: 0,
      errors: ['boom'],
      portfolioValue: 900,
      prices: {}
    });

    const job = createJob({
      type: PaperTradingJobType.TICK,
      sessionId: 'session-2b',
      userId: 'user-2'
    });

    await processor.process(job);

    expect(session.status).toBe(PaperTradingStatus.PAUSED);
    expect(session.retryAttempts).toBe(0); // Reset after exhaustion
    expect(paperTradingService.removeTickJobs).toHaveBeenCalledWith('session-2b');
    expect(streamService.publishStatus).toHaveBeenCalledWith(
      'session-2b',
      'paused',
      'consecutive_errors',
      expect.objectContaining({ retriesExhausted: true })
    );

    const endTimer = metricsService.startBacktestTimer.mock.results[0].value;
    expect(endTimer).toHaveBeenCalled();
  });

  it('resets error count and retryAttempts on successful tick', async () => {
    const session = {
      id: 'session-3',
      status: PaperTradingStatus.ACTIVE,
      initialCapital: 1000,
      tickIntervalMs: 1000,
      consecutiveErrors: 2,
      retryAttempts: 1,
      peakPortfolioValue: 1000,
      tickCount: 0
    };

    const { processor, sessionRepository, engineService, streamService, metricsService } = createProcessor();

    sessionRepository.findOne.mockResolvedValue(session);
    engineService.processTick.mockResolvedValue({
      processed: true,
      signalsReceived: 0,
      ordersExecuted: 0,
      errors: [],
      portfolioValue: 1050,
      prices: { 'BTC/USD': 50000 }
    });

    const job = createJob({
      type: PaperTradingJobType.TICK,
      sessionId: 'session-3',
      userId: 'user-3'
    });

    await processor.process(job);

    expect(session.consecutiveErrors).toBe(0);
    expect(session.retryAttempts).toBe(0);
    expect(session.tickCount).toBe(1);
    expect(sessionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ consecutiveErrors: 0, retryAttempts: 0 })
    );
    expect(streamService.publishTick).toHaveBeenCalledWith('session-3', expect.any(Object));

    const endTimer = metricsService.startBacktestTimer.mock.results[0].value;
    expect(endTimer).toHaveBeenCalled();
  });

  it('retry tick success resets retryAttempts and reschedules normal ticks', async () => {
    const session = {
      id: 'session-retry-ok',
      status: PaperTradingStatus.ACTIVE,
      initialCapital: 1000,
      tickIntervalMs: 30000,
      consecutiveErrors: 2,
      retryAttempts: 2,
      peakPortfolioValue: 1000,
      tickCount: 10,
      totalTrades: 5,
      maxDrawdown: 0.05,
      user: { id: 'user-r1' },
      exchangeKey: { id: 'ek-1' }
    };

    const { processor, sessionRepository, paperTradingService, engineService, streamService, metricsService } =
      createProcessor();

    sessionRepository.findOne.mockResolvedValue(session);
    engineService.processTick.mockResolvedValue({
      processed: true,
      signalsReceived: 1,
      ordersExecuted: 0,
      errors: [],
      portfolioValue: 1020,
      prices: { 'BTC/USD': 51000 }
    });

    const job = createJob({
      type: PaperTradingJobType.RETRY_TICK,
      sessionId: 'session-retry-ok',
      userId: 'user-r1',
      retryAttempt: 2,
      delayMs: 2000
    });

    await processor.process(job);

    expect(session.consecutiveErrors).toBe(0);
    expect(session.retryAttempts).toBe(0);
    expect(session.tickCount).toBe(11);
    expect(paperTradingService.scheduleTickJob).toHaveBeenCalledWith('session-retry-ok', 'user-r1', 30000);
    expect(streamService.publishStatus).toHaveBeenCalledWith(
      'session-retry-ok',
      'active',
      'retry_recovered',
      expect.objectContaining({ retryAttempt: 2 })
    );

    // Verify metrics timer was started and stopped
    expect(metricsService.startBacktestTimer).toHaveBeenCalledWith('paper-trading');
    const endTimer = metricsService.startBacktestTimer.mock.results[0].value;
    expect(endTimer).toHaveBeenCalled();
  });

  it('retry tick failure triggers next retry with increased delay', async () => {
    const session = {
      id: 'session-retry-fail',
      status: PaperTradingStatus.ACTIVE,
      initialCapital: 1000,
      tickIntervalMs: 30000,
      consecutiveErrors: 0,
      retryAttempts: 1, // Already had one retry
      peakPortfolioValue: 1000,
      tickCount: 10,
      user: { id: 'user-r2' },
      exchangeKey: { id: 'ek-2' }
    };

    const { processor, sessionRepository, paperTradingService, engineService, metricsService } = createProcessor();

    sessionRepository.findOne.mockResolvedValue(session);
    engineService.processTick.mockResolvedValue({
      processed: false,
      signalsReceived: 0,
      ordersExecuted: 0,
      errors: ['still timing out'],
      portfolioValue: 1000,
      prices: {}
    });

    const job = createJob({
      type: PaperTradingJobType.RETRY_TICK,
      sessionId: 'session-retry-fail',
      userId: 'user-r2',
      retryAttempt: 1,
      delayMs: 1000
    });

    await processor.process(job);

    // retryAttempts should increment from 1 → 2
    expect(session.retryAttempts).toBe(2);
    expect(session.consecutiveErrors).toBe(0);
    // Delay should be 1000 * 2^1 = 2000 (backoff from attempt index 1)
    expect(paperTradingService.scheduleRetryTick).toHaveBeenCalledWith('session-retry-fail', 'user-r2', 2000, 2);
    expect(paperTradingService.removeTickJobs).toHaveBeenCalledWith('session-retry-fail');

    // Verify metrics timer was started and stopped
    const endTimer = metricsService.startBacktestTimer.mock.results[0].value;
    expect(endTimer).toHaveBeenCalled();
  });

  it('handles stop-session job and calculates final metrics', async () => {
    const session: Record<string, any> = {
      id: 'session-4',
      status: PaperTradingStatus.STOPPED,
      initialCapital: 1000,
      currentPortfolioValue: 1200,
      totalReturn: 0.2,
      algorithm: { id: 'algo-paper-1' }
    };

    const { processor, sessionRepository, engineService, streamService, metricsService } = createProcessor();

    sessionRepository.findOne.mockResolvedValue(session);
    engineService.calculateSessionMetrics.mockResolvedValue({
      sharpeRatio: 1.5,
      winRate: 0.6,
      totalTrades: 10,
      winningTrades: 6,
      losingTrades: 4,
      maxDrawdown: 0.1
    });

    const job = createJob({
      type: PaperTradingJobType.STOP_SESSION,
      sessionId: 'session-4',
      userId: 'user-4',
      reason: 'user_cancelled'
    });

    await processor.process(job);

    expect(engineService.calculateSessionMetrics).toHaveBeenCalledWith(session);
    expect(session.sharpeRatio).toBe(1.5);
    expect(session.winRate).toBe(0.6);
    expect(session.totalTrades).toBe(10);
    expect(sessionRepository.save).toHaveBeenCalled();
    expect(streamService.publishStatus).toHaveBeenCalledWith(
      'session-4',
      'stopped',
      'user_cancelled',
      expect.objectContaining({
        metrics: expect.objectContaining({
          sharpeRatio: 1.5,
          maxDrawdown: 0.1
        })
      })
    );
    expect(metricsService.recordBacktestFinalMetrics).toHaveBeenCalledWith('algo-paper-1', {
      totalReturn: 0.2,
      sharpeRatio: 1.5,
      maxDrawdown: 0.1,
      tradeCount: 10
    });
    expect(engineService.clearThrottleState).toHaveBeenCalledWith('session-4');
  });

  it('marks session failed on unrecoverable error', async () => {
    const session = {
      id: 'session-5',
      status: PaperTradingStatus.ACTIVE,
      initialCapital: 1000,
      peakPortfolioValue: 1000,
      consecutiveErrors: 0
    };

    const { processor, sessionRepository, paperTradingService, engineService, streamService, metricsService } =
      createProcessor();

    sessionRepository.findOne.mockResolvedValue(session);
    engineService.processTick.mockRejectedValue(new Error('Invalid API key - authentication failed'));

    const job = createJob({
      type: PaperTradingJobType.TICK,
      sessionId: 'session-5',
      userId: 'user-5'
    });

    await processor.process(job);

    expect(paperTradingService.markFailed).toHaveBeenCalledWith(
      'session-5',
      expect.stringContaining('Unrecoverable error')
    );
    expect(streamService.publishStatus).toHaveBeenCalledWith(
      'session-5',
      'failed',
      'unrecoverable_error',
      expect.objectContaining({ errorType: 'unrecoverable' })
    );
    expect(engineService.clearThrottleState).toHaveBeenCalledWith('session-5');

    const endTimer = metricsService.startBacktestTimer.mock.results[0].value;
    expect(endTimer).toHaveBeenCalled();
  });

  it('skips tick if session not found and removes jobs', async () => {
    const { processor, sessionRepository, paperTradingService } = createProcessor();

    sessionRepository.findOne.mockResolvedValue(null);

    const job = createJob({
      type: PaperTradingJobType.TICK,
      sessionId: 'session-nonexistent',
      userId: 'user-1'
    });

    await processor.process(job);

    expect(paperTradingService.removeTickJobs).toHaveBeenCalledWith('session-nonexistent');
  });

  it('silently returns on subsequent ticks for a missing session (no repeated cleanup)', async () => {
    const { processor, sessionRepository, paperTradingService } = createProcessor();

    sessionRepository.findOne.mockResolvedValue(null);

    const job = createJob({
      type: PaperTradingJobType.TICK,
      sessionId: 'session-gone',
      userId: 'user-1'
    });

    await processor.process(job);
    expect(paperTradingService.removeTickJobs).toHaveBeenCalledTimes(1);

    paperTradingService.removeTickJobs.mockClear();

    await processor.process(job);
    expect(paperTradingService.removeTickJobs).not.toHaveBeenCalled();
  });

  it('removes tick jobs when session is externally marked as FAILED', async () => {
    const session = {
      id: 'session-failed',
      status: PaperTradingStatus.FAILED,
      initialCapital: 1000
    };

    const { processor, sessionRepository, paperTradingService, engineService } = createProcessor();

    sessionRepository.findOne.mockResolvedValue(session);

    const job = createJob({
      type: PaperTradingJobType.TICK,
      sessionId: 'session-failed',
      userId: 'user-1'
    });

    await processor.process(job);

    expect(paperTradingService.removeTickJobs).toHaveBeenCalledWith('session-failed');
    expect(engineService.processTick).not.toHaveBeenCalled();
  });

  it('silently returns on subsequent ticks for a FAILED session (no repeated cleanup)', async () => {
    const session = {
      id: 'session-failed-dup',
      status: PaperTradingStatus.FAILED,
      initialCapital: 1000
    };

    const { processor, sessionRepository, paperTradingService, engineService } = createProcessor();

    sessionRepository.findOne.mockResolvedValue(session);

    const job = createJob({
      type: PaperTradingJobType.TICK,
      sessionId: 'session-failed-dup',
      userId: 'user-1'
    });

    // First tick: should log warning and remove jobs
    await processor.process(job);
    expect(paperTradingService.removeTickJobs).toHaveBeenCalledTimes(1);

    paperTradingService.removeTickJobs.mockClear();

    // Second tick: should silently return
    await processor.process(job);
    expect(paperTradingService.removeTickJobs).not.toHaveBeenCalled();
    expect(engineService.processTick).not.toHaveBeenCalled();
  });

  it('skips tick if session is not active', async () => {
    const session = {
      id: 'session-6',
      status: PaperTradingStatus.PAUSED,
      initialCapital: 1000
    };

    const { processor, sessionRepository, engineService } = createProcessor();

    sessionRepository.findOne.mockResolvedValue(session);

    const job = createJob({
      type: PaperTradingJobType.TICK,
      sessionId: 'session-6',
      userId: 'user-6'
    });

    await processor.process(job);

    expect(engineService.processTick).not.toHaveBeenCalled();
  });

  it('does not start session if already completed', async () => {
    const session = {
      id: 'session-7',
      status: PaperTradingStatus.COMPLETED,
      initialCapital: 1000
    };

    const { processor, sessionRepository, paperTradingService } = createProcessor();

    sessionRepository.findOne.mockResolvedValue(session);

    const job = createJob({
      type: PaperTradingJobType.START_SESSION,
      sessionId: 'session-7',
      userId: 'user-7'
    });

    await processor.process(job);

    expect(paperTradingService.scheduleTickJob).not.toHaveBeenCalled();
  });

  it('skips retry tick if session is no longer active', async () => {
    const session = {
      id: 'session-stopped-retry',
      status: PaperTradingStatus.STOPPED,
      initialCapital: 1000
    };

    const { processor, sessionRepository, engineService, metricsService } = createProcessor();

    sessionRepository.findOne.mockResolvedValue(session);

    const job = createJob({
      type: PaperTradingJobType.RETRY_TICK,
      sessionId: 'session-stopped-retry',
      userId: 'user-1',
      retryAttempt: 1,
      delayMs: 1000
    });

    await processor.process(job);

    expect(engineService.processTick).not.toHaveBeenCalled();
    // Timer should not start for skipped ticks
    expect(metricsService.startBacktestTimer).not.toHaveBeenCalled();
  });

  it('caps backoff delay at 30 minutes', async () => {
    const session = {
      id: 'session-cap',
      status: PaperTradingStatus.ACTIVE,
      initialCapital: 1000,
      tickIntervalMs: 1000,
      consecutiveErrors: 1,
      retryAttempts: 5,
      peakPortfolioValue: 1000,
      user: { id: 'user-cap' }
    };

    // Use a large retryBackoffMs so uncapped delay would exceed 30 minutes
    const { processor, sessionRepository, paperTradingService, engineService } = createProcessor({
      config: { maxConsecutiveErrors: 2, maxRetryAttempts: 10, retryBackoffMs: 1_000_000 }
    });

    sessionRepository.findOne.mockResolvedValue(session);
    engineService.processTick.mockResolvedValue({
      processed: false,
      signalsReceived: 0,
      ordersExecuted: 0,
      errors: ['timeout'],
      portfolioValue: 900,
      prices: {}
    });

    const job = createJob({
      type: PaperTradingJobType.TICK,
      sessionId: 'session-cap',
      userId: 'user-cap'
    });

    await processor.process(job);

    // Delay should be capped at 30 minutes (1,800,000ms)
    const scheduledDelay = paperTradingService.scheduleRetryTick.mock.calls[0][2];
    expect(scheduledDelay).toBeLessThanOrEqual(1_800_000);
  });

  it('increments consecutiveErrors on recoverable thrown error without pausing', async () => {
    const session = {
      id: 'session-recoverable',
      status: PaperTradingStatus.ACTIVE,
      initialCapital: 1000,
      peakPortfolioValue: 1000,
      consecutiveErrors: 0,
      retryAttempts: 0,
      user: { id: 'user-rec' }
    };

    const { processor, sessionRepository, engineService, streamService } = createProcessor();

    sessionRepository.findOne.mockResolvedValue(session);
    engineService.processTick.mockRejectedValue(new Error('Network timeout'));

    const job = createJob({
      type: PaperTradingJobType.TICK,
      sessionId: 'session-recoverable',
      userId: 'user-rec'
    });

    await processor.process(job);

    expect(session.consecutiveErrors).toBe(1);
    expect(session.status).toBe(PaperTradingStatus.ACTIVE);
    expect(sessionRepository.save).toHaveBeenCalledWith(expect.objectContaining({ consecutiveErrors: 1 }));
    expect(streamService.publishLog).toHaveBeenCalledWith(
      'session-recoverable',
      'warn',
      expect.stringContaining('Recoverable error'),
      expect.objectContaining({ errorType: 'recoverable', consecutiveErrors: 1 })
    );
  });

  it('emits event for notify-pipeline job', async () => {
    const { processor, eventEmitter } = createProcessor();

    const job = createJob({
      type: PaperTradingJobType.NOTIFY_PIPELINE,
      sessionId: 'session-notify',
      pipelineId: 'pipeline-1',
      stoppedReason: 'duration_reached'
    });

    await processor.process(job);

    expect(eventEmitter.emit).toHaveBeenCalledWith('paper-trading.completed', {
      sessionId: 'session-notify',
      pipelineId: 'pipeline-1',
      stoppedReason: 'duration_reached'
    });
  });

  it('marks session failed on unrecoverable error during retry tick', async () => {
    const session = {
      id: 'session-retry-unrec',
      status: PaperTradingStatus.ACTIVE,
      initialCapital: 1000,
      retryAttempts: 1,
      user: { id: 'user-ru' }
    };

    const { processor, sessionRepository, paperTradingService, engineService, streamService } = createProcessor();

    sessionRepository.findOne.mockResolvedValue(session);
    engineService.processTick.mockRejectedValue(new Error('Invalid API key'));

    const job = createJob({
      type: PaperTradingJobType.RETRY_TICK,
      sessionId: 'session-retry-unrec',
      userId: 'user-ru',
      retryAttempt: 1,
      delayMs: 1000
    });

    await processor.process(job);

    expect(paperTradingService.markFailed).toHaveBeenCalledWith(
      'session-retry-unrec',
      expect.stringContaining('Unrecoverable error')
    );
    expect(streamService.publishStatus).toHaveBeenCalledWith(
      'session-retry-unrec',
      'failed',
      'unrecoverable_error',
      expect.objectContaining({ errorType: 'unrecoverable' })
    );
    expect(engineService.clearThrottleState).toHaveBeenCalledWith('session-retry-unrec');
  });

  it('marks session failed when start-session throws', async () => {
    const session = {
      id: 'session-start-fail',
      status: PaperTradingStatus.ACTIVE,
      initialCapital: 1000,
      tickIntervalMs: 30000,
      startedAt: new Date()
    };

    const { processor, sessionRepository, paperTradingService, streamService } = createProcessor();

    sessionRepository.findOne.mockResolvedValue(session);
    sessionRepository.save.mockRejectedValue(new Error('DB connection lost'));

    const job = createJob({
      type: PaperTradingJobType.START_SESSION,
      sessionId: 'session-start-fail',
      userId: 'user-sf'
    });

    await processor.process(job);

    expect(paperTradingService.markFailed).toHaveBeenCalledWith(
      'session-start-fail',
      expect.stringContaining('DB connection lost')
    );
    expect(streamService.publishStatus).toHaveBeenCalledWith(
      'session-start-fail',
      'failed',
      expect.stringContaining('DB connection lost')
    );
  });

  it('restores throttle state from DB when engine has none in memory', async () => {
    const session = {
      id: 'session-throttle',
      status: PaperTradingStatus.ACTIVE,
      initialCapital: 1000,
      peakPortfolioValue: 1000,
      consecutiveErrors: 0,
      tickCount: 5,
      throttleState: { lastCallTimestamps: { 'BTC/USD': 123456 } }
    };

    const { processor, sessionRepository, engineService } = createProcessor();

    sessionRepository.findOne.mockResolvedValue(session);
    engineService.hasThrottleState.mockReturnValue(false);
    engineService.processTick.mockResolvedValue({
      processed: true,
      signalsReceived: 0,
      ordersExecuted: 0,
      errors: [],
      portfolioValue: 1000,
      prices: {}
    });

    const job = createJob({
      type: PaperTradingJobType.TICK,
      sessionId: 'session-throttle',
      userId: 'user-th'
    });

    await processor.process(job);

    expect(engineService.restoreThrottleState).toHaveBeenCalledWith('session-throttle', session.throttleState);
  });

  it('increments totalTrades when orders are executed', async () => {
    const session = {
      id: 'session-trades',
      status: PaperTradingStatus.ACTIVE,
      initialCapital: 1000,
      peakPortfolioValue: 1000,
      consecutiveErrors: 0,
      tickCount: 0,
      totalTrades: 3
    };

    const { processor, sessionRepository, engineService } = createProcessor();

    sessionRepository.findOne.mockResolvedValue(session);
    engineService.processTick.mockResolvedValue({
      processed: true,
      signalsReceived: 2,
      ordersExecuted: 2,
      errors: [],
      portfolioValue: 1050,
      prices: { 'BTC/USD': 50000 }
    });

    const job = createJob({
      type: PaperTradingJobType.TICK,
      sessionId: 'session-trades',
      userId: 'user-t1'
    });

    await processor.process(job);

    expect(session.totalTrades).toBe(5);
  });

  it('triggers markCompleted when stop condition maxDrawdown is exceeded', async () => {
    const session = {
      id: 'session-stop-dd',
      status: PaperTradingStatus.ACTIVE,
      initialCapital: 1000,
      peakPortfolioValue: 1000,
      consecutiveErrors: 0,
      tickCount: 5,
      stopConditions: { maxDrawdown: 0.05 }
    };

    const { processor, sessionRepository, engineService, paperTradingService } = createProcessor();

    sessionRepository.findOne.mockResolvedValue(session);
    engineService.processTick.mockResolvedValue({
      processed: true,
      signalsReceived: 0,
      ordersExecuted: 0,
      errors: [],
      portfolioValue: 900, // 10% drawdown from peak of 1000
      prices: {}
    });

    const job = createJob({
      type: PaperTradingJobType.TICK,
      sessionId: 'session-stop-dd',
      userId: 'user-dd'
    });

    await processor.process(job);

    expect(paperTradingService.markCompleted).toHaveBeenCalledWith('session-stop-dd', 'max_drawdown');
  });

  it('triggers markCompleted when minTrades gate is met', async () => {
    const session = {
      id: 'session-min-trades',
      status: PaperTradingStatus.ACTIVE,
      initialCapital: 1000,
      peakPortfolioValue: 1000,
      consecutiveErrors: 0,
      tickCount: 20,
      totalTrades: 38,
      minTrades: 40
    };

    const { processor, sessionRepository, engineService, paperTradingService } = createProcessor();

    sessionRepository.findOne.mockResolvedValue(session);
    engineService.processTick.mockResolvedValue({
      processed: true,
      signalsReceived: 2,
      ordersExecuted: 2,
      errors: [],
      portfolioValue: 1050,
      prices: { 'BTC/USD': 50000 }
    });

    const job = createJob({
      type: PaperTradingJobType.TICK,
      sessionId: 'session-min-trades',
      userId: 'user-mt'
    });

    await processor.process(job);

    // totalTrades should be 38 + 2 = 40, meeting minTrades
    expect(session.totalTrades).toBe(40);
    expect(paperTradingService.markCompleted).toHaveBeenCalledWith('session-min-trades', 'min_trades_reached');
  });

  it('does not trigger minTrades completion when minTrades is null (backward compat)', async () => {
    const session = {
      id: 'session-no-min',
      status: PaperTradingStatus.ACTIVE,
      initialCapital: 1000,
      peakPortfolioValue: 1000,
      consecutiveErrors: 0,
      tickCount: 20,
      totalTrades: 50,
      minTrades: null as number | null
    };

    const { processor, sessionRepository, engineService, paperTradingService } = createProcessor();

    sessionRepository.findOne.mockResolvedValue(session);
    engineService.processTick.mockResolvedValue({
      processed: true,
      signalsReceived: 0,
      ordersExecuted: 0,
      errors: [],
      portfolioValue: 1050,
      prices: {}
    });

    const job = createJob({
      type: PaperTradingJobType.TICK,
      sessionId: 'session-no-min',
      userId: 'user-nm'
    });

    await processor.process(job);

    expect(paperTradingService.markCompleted).not.toHaveBeenCalled();
  });

  it('duration fires as hard cap even when minTrades is not met', async () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 31); // 31 days ago

    const session = {
      id: 'session-duration-cap',
      status: PaperTradingStatus.ACTIVE,
      initialCapital: 1000,
      peakPortfolioValue: 1000,
      consecutiveErrors: 0,
      tickCount: 10,
      totalTrades: 5,
      minTrades: 40,
      duration: '30d',
      startedAt: pastDate
    };

    const { processor, sessionRepository, engineService, paperTradingService } = createProcessor();

    sessionRepository.findOne.mockResolvedValue(session);
    engineService.processTick.mockResolvedValue({
      processed: true,
      signalsReceived: 0,
      ordersExecuted: 0,
      errors: [],
      portfolioValue: 1010,
      prices: {}
    });

    const job = createJob({
      type: PaperTradingJobType.TICK,
      sessionId: 'session-duration-cap',
      userId: 'user-dc'
    });

    await processor.process(job);

    // minTrades not met (5 < 40), but duration exceeded → should complete via duration
    expect(paperTradingService.markCompleted).toHaveBeenCalledWith('session-duration-cap', 'duration_reached');
  });

  it('does not double-complete when stop condition fires before minTrades check', async () => {
    const session = {
      id: 'session-no-double',
      status: PaperTradingStatus.ACTIVE,
      initialCapital: 1000,
      peakPortfolioValue: 1000,
      consecutiveErrors: 0,
      tickCount: 20,
      totalTrades: 38,
      minTrades: 40,
      stopConditions: { maxDrawdown: 0.05 }
    };

    const { processor, sessionRepository, engineService, paperTradingService } = createProcessor();

    sessionRepository.findOne.mockResolvedValue(session);
    engineService.processTick.mockResolvedValue({
      processed: true,
      signalsReceived: 2,
      ordersExecuted: 2,
      errors: [],
      portfolioValue: 900, // 10% drawdown, exceeds 5% limit
      prices: {}
    });

    const job = createJob({
      type: PaperTradingJobType.TICK,
      sessionId: 'session-no-double',
      userId: 'user-nd'
    });

    await processor.process(job);

    // Stop condition fires first (max_drawdown), minTrades should NOT also fire
    expect(paperTradingService.markCompleted).toHaveBeenCalledTimes(1);
    expect(paperTradingService.markCompleted).toHaveBeenCalledWith('session-no-double', 'max_drawdown');
  });

  it('clears cleanedUpSessions set when it exceeds the threshold to prevent memory leaks', async () => {
    const { processor, sessionRepository, paperTradingService } = createProcessor();

    sessionRepository.findOne.mockResolvedValue(null);

    // Fill the set to the limit (MAX_CLEANUP_CACHE = 500)
    for (let i = 0; i < 500; i++) {
      const job = createJob({
        type: PaperTradingJobType.TICK,
        sessionId: `session-cleanup-${i}`,
        userId: 'user-1'
      });
      await processor.process(job);
    }

    // All 500 sessions should have been cleaned up
    expect(paperTradingService.removeTickJobs).toHaveBeenCalledTimes(500);
    paperTradingService.removeTickJobs.mockClear();

    // Next session triggers a clear + re-add, so cleanup runs again
    const overflowJob = createJob({
      type: PaperTradingJobType.TICK,
      sessionId: 'session-overflow',
      userId: 'user-1'
    });
    await overflowJob;
    await processor.process(overflowJob);
    expect(paperTradingService.removeTickJobs).toHaveBeenCalledWith('session-overflow');

    // Verify a previously-cached session is now re-cleaned (set was cleared)
    paperTradingService.removeTickJobs.mockClear();
    const reprocessJob = createJob({
      type: PaperTradingJobType.TICK,
      sessionId: 'session-cleanup-0',
      userId: 'user-1'
    });
    await processor.process(reprocessJob);
    expect(paperTradingService.removeTickJobs).toHaveBeenCalledWith('session-cleanup-0');
  });

  it('triggers markCompleted when stop condition targetReturn is reached', async () => {
    const session = {
      id: 'session-stop-target',
      status: PaperTradingStatus.ACTIVE,
      initialCapital: 1000,
      peakPortfolioValue: 1000,
      consecutiveErrors: 0,
      tickCount: 5,
      stopConditions: { targetReturn: 0.1 }
    };

    const { processor, sessionRepository, engineService, paperTradingService } = createProcessor();

    sessionRepository.findOne.mockResolvedValue(session);
    engineService.processTick.mockResolvedValue({
      processed: true,
      signalsReceived: 0,
      ordersExecuted: 0,
      errors: [],
      portfolioValue: 1150, // 15% return, exceeds 10% target
      prices: {}
    });

    const job = createJob({
      type: PaperTradingJobType.TICK,
      sessionId: 'session-stop-target',
      userId: 'user-tr'
    });

    await processor.process(job);

    expect(paperTradingService.markCompleted).toHaveBeenCalledWith('session-stop-target', 'target_reached');
  });

  it('should update maxDrawdown when portfolio value drops below peak', async () => {
    const session = {
      id: 'session-drawdown',
      status: PaperTradingStatus.ACTIVE,
      initialCapital: 1000,
      peakPortfolioValue: 1000,
      maxDrawdown: 0,
      consecutiveErrors: 0,
      tickCount: 5,
      totalTrades: 0
    };

    const { processor, sessionRepository, engineService } = createProcessor();

    sessionRepository.findOne.mockResolvedValue(session);
    engineService.processTick.mockResolvedValue({
      processed: true,
      signalsReceived: 0,
      ordersExecuted: 0,
      errors: [],
      portfolioValue: 850, // 15% drawdown from peak of 1000
      prices: {}
    });

    const job = createJob({
      type: PaperTradingJobType.TICK,
      sessionId: 'session-drawdown',
      userId: 'user-dd'
    });

    await processor.process(job);

    expect(session.maxDrawdown).toBeCloseTo(0.15, 2);
    expect(sessionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ maxDrawdown: expect.closeTo(0.15, 2) })
    );
  });
});
