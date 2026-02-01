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
      markFailed: jest.fn(),
      markCompleted: jest.fn()
    };

    const engineService = {
      processTick: jest.fn(),
      calculateSessionMetrics: jest.fn()
    };

    const streamService = {
      publishStatus: jest.fn(),
      publishLog: jest.fn(),
      publishTick: jest.fn(),
      publishMetric: jest.fn()
    };

    const metricsService = {
      startBacktestTimer: jest.fn().mockReturnValue(jest.fn())
    };

    const eventEmitter = {
      emit: jest.fn()
    };

    const config = { maxConsecutiveErrors: 2 };

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

  it('pauses session after max consecutive errors on tick', async () => {
    const session = {
      id: 'session-2',
      status: PaperTradingStatus.ACTIVE,
      initialCapital: 1000,
      tickIntervalMs: 1000,
      consecutiveErrors: 1,
      peakPortfolioValue: 1000
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
      sessionId: 'session-2',
      userId: 'user-2'
    });

    await processor.process(job);

    expect(session.status).toBe(PaperTradingStatus.PAUSED);
    expect(paperTradingService.removeTickJobs).toHaveBeenCalledWith('session-2');
    expect(streamService.publishStatus).toHaveBeenCalledWith(
      'session-2',
      'paused',
      'consecutive_errors',
      expect.objectContaining({ consecutiveErrors: 2 })
    );

    const endTimer = metricsService.startBacktestTimer.mock.results[0].value;
    expect(endTimer).toHaveBeenCalled();
  });

  it('resets error count on successful tick', async () => {
    const session = {
      id: 'session-3',
      status: PaperTradingStatus.ACTIVE,
      initialCapital: 1000,
      tickIntervalMs: 1000,
      consecutiveErrors: 2,
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
    expect(session.tickCount).toBe(1);
    expect(sessionRepository.save).toHaveBeenCalledWith(expect.objectContaining({ consecutiveErrors: 0 }));
    expect(streamService.publishTick).toHaveBeenCalledWith('session-3', expect.any(Object));

    const endTimer = metricsService.startBacktestTimer.mock.results[0].value;
    expect(endTimer).toHaveBeenCalled();
  });

  it('handles stop-session job and calculates final metrics', async () => {
    const session: Record<string, any> = {
      id: 'session-4',
      status: PaperTradingStatus.STOPPED,
      initialCapital: 1000,
      currentPortfolioValue: 1200,
      totalReturn: 0.2
    };

    const { processor, sessionRepository, engineService, streamService } = createProcessor();

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
});
