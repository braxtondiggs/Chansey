import { Processor } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { Job } from 'bullmq';
import { Repository } from 'typeorm';

import { PaperTradingSession, PaperTradingStatus } from './entities';
import { PaperTradingEngineService } from './paper-trading-engine.service';
import { classifyError, UnrecoverableError } from './paper-trading-error-classifier.util';
import { PaperTradingJobService } from './paper-trading-job.service';
import { PaperTradingRetryService } from './paper-trading-retry.service';
import { applySuccessfulTickResult, evaluateStopReason } from './paper-trading-session.util';
import { PaperTradingStreamService } from './paper-trading-stream.service';
import { paperTradingConfig } from './paper-trading.config';
import {
  AnyPaperTradingJobData,
  NotifyPipelineJobData,
  PaperTradingJobType,
  RetryTickJobData,
  StartSessionJobData,
  StopSessionJobData,
  TickJobData
} from './paper-trading.job-data';

import { ExchangeKey } from '../../exchange/exchange-key/exchange-key.entity';
import { FailSafeWorkerHost } from '../../failed-jobs/fail-safe-worker-host';
import { FailedJobService } from '../../failed-jobs/failed-job.service';
import { MetricsService } from '../../metrics/metrics.service';
import { PIPELINE_EVENTS } from '../../pipeline/interfaces';
import { toErrorInfo } from '../../shared/error.util';

const MAX_CLEANUP_CACHE = 500;

@Injectable()
@Processor('paper-trading', { lockDuration: 60_000, stalledInterval: 30_000 })
export class PaperTradingProcessor extends FailSafeWorkerHost {
  private readonly logger = new Logger(PaperTradingProcessor.name);
  private readonly maxConsecutiveErrors: number;
  private readonly cleanedUpSessions = new Set<string>();

  constructor(
    @Inject(paperTradingConfig.KEY) private readonly config: ConfigType<typeof paperTradingConfig>,
    @InjectRepository(PaperTradingSession)
    private readonly sessionRepository: Repository<PaperTradingSession>,
    @InjectRepository(ExchangeKey)
    private readonly exchangeKeyRepository: Repository<ExchangeKey>,
    private readonly jobService: PaperTradingJobService,
    private readonly engineService: PaperTradingEngineService,
    private readonly streamService: PaperTradingStreamService,
    private readonly metricsService: MetricsService,
    private readonly eventEmitter: EventEmitter2,
    failedJobService: FailedJobService,
    private readonly retryService: PaperTradingRetryService
  ) {
    super(failedJobService);
    this.maxConsecutiveErrors = config.maxConsecutiveErrors;
  }

  async process(job: Job<AnyPaperTradingJobData>): Promise<void> {
    const { type, sessionId } = job.data;

    this.logger.debug(`Processing ${type} job for session ${sessionId}`);

    switch (type) {
      case PaperTradingJobType.START_SESSION:
        await this.handleStartSession(job.data as StartSessionJobData);
        break;
      case PaperTradingJobType.TICK:
        await this.handleTick(job.data as TickJobData);
        break;
      case PaperTradingJobType.RETRY_TICK:
        await this.retryService.handleRetryTick(job.data as RetryTickJobData);
        break;
      case PaperTradingJobType.STOP_SESSION:
        await this.handleStopSession(job.data as StopSessionJobData);
        break;
      case PaperTradingJobType.NOTIFY_PIPELINE:
        await this.handleNotifyPipeline(job.data as NotifyPipelineJobData);
        break;
      default:
        this.logger.warn(`Unknown job type: ${type}`);
    }
  }

  /**
   * Handle session start - initialize and schedule tick jobs
   */
  private async handleStartSession(data: StartSessionJobData): Promise<void> {
    const { sessionId, userId } = data;
    this.logger.log(`Starting paper trading session ${sessionId}`);

    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
      relations: ['algorithm', 'exchangeKey', 'exchangeKey.exchange']
    });

    if (!session) {
      this.logger.error(`Session ${sessionId} not found`);
      return;
    }

    if (session.status !== PaperTradingStatus.ACTIVE) {
      this.logger.warn(`Session ${sessionId} is not active (status: ${session.status})`);
      return;
    }

    try {
      // Initialize session metrics
      session.currentPortfolioValue = session.initialCapital;
      session.peakPortfolioValue = session.initialCapital;
      session.maxDrawdown = 0;
      session.totalReturn = 0;
      await this.sessionRepository.save(session);

      // Emit status update
      await this.streamService.publishStatus(sessionId, 'active', undefined, {
        startedAt: session.startedAt?.toISOString()
      });

      // Schedule repeatable tick jobs
      await this.jobService.scheduleTickJob(sessionId, userId, session.tickIntervalMs);

      this.logger.log(`Session ${sessionId} started successfully, tick jobs scheduled`);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to start session ${sessionId}: ${err.message}`, err.stack);
      await this.jobService.markFailed(sessionId, err.message);
      await this.streamService.publishStatus(sessionId, 'failed', err.message);
    }
  }

  /**
   * Handle tick processing - fetch prices, run algorithm, execute orders
   */
  private async handleTick(data: TickJobData): Promise<void> {
    const { sessionId } = data;

    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
      relations: ['algorithm', 'exchangeKey', 'exchangeKey.exchange', 'user']
    });

    if (!session) {
      if (!this.cleanedUpSessions.has(sessionId)) {
        this.logger.warn(`Session ${sessionId} not found, removing tick jobs`);
        await this.jobService.removeTickJobs(sessionId);
        this.trackCleanedUpSession(sessionId);
      }
      return;
    }

    // Actively stop ticks if externally marked as FAILED
    if (session.status === PaperTradingStatus.FAILED) {
      if (!this.cleanedUpSessions.has(sessionId)) {
        this.logger.warn(`Session ${sessionId} was externally marked as FAILED, removing tick jobs`);
        await this.jobService.removeTickJobs(sessionId);
        this.trackCleanedUpSession(sessionId);
      }
      return;
    }

    if (session.status !== PaperTradingStatus.ACTIVE) {
      this.logger.debug(`Session ${sessionId} is not active (status: ${session.status}), skipping tick`);
      return;
    }

    this.restoreThrottleStateIfNeeded(sessionId, session);

    const endTimer = this.metricsService.startBacktestTimer('paper-trading');

    try {
      // Process tick
      const result = await this.engineService.processTick(session, session.exchangeKey);

      if (!result.processed) {
        // Increment error count
        session.consecutiveErrors++;
        await this.sessionRepository.save(session);

        if (session.consecutiveErrors >= this.maxConsecutiveErrors) {
          this.logger.warn(`Session ${sessionId} reached max consecutive errors, pausing`);
          await this.retryService.handleConsecutiveErrors(session, result.errors.join('; '));
          return;
        }

        await this.streamService.publishLog(sessionId, 'warn', `Tick processing failed: ${result.errors.join('; ')}`);
        return;
      }

      // Persist throttle state to DB for restart resilience
      const serializedThrottle = this.engineService.getSerializedThrottleState(sessionId);
      if (serializedThrottle) {
        session.throttleState = serializedThrottle;
      }

      // Persist exit tracker state to DB for restart resilience
      const serializedExitTracker = this.engineService.getSerializedExitTrackerState(sessionId);
      if (serializedExitTracker) {
        session.exitTrackerState = serializedExitTracker;
      }

      // Apply successful tick result (reset counters, update metrics) and persist
      const currentDrawdown = applySuccessfulTickResult(session, result);
      await this.sessionRepository.save(session);

      // Stop-condition precedence (order matters): safety → min-trades → duration
      const stopReason = evaluateStopReason(session, result.portfolioValue, currentDrawdown);
      if (stopReason) {
        this.logger.log(`Session ${session.id} stop condition triggered: ${stopReason}`);
        await this.jobService.markCompleted(session.id, stopReason);
        session.status = PaperTradingStatus.COMPLETED;
      }

      // Emit tick event
      await this.streamService.publishTick(sessionId, {
        portfolioValue: result.portfolioValue,
        prices: result.prices,
        tickCount: session.tickCount,
        signalsReceived: result.signalsReceived,
        ordersExecuted: result.ordersExecuted
      });

      // Emit metrics periodically
      if (session.tickCount % 10 === 0) {
        await this.streamService.publishMetric(sessionId, 'portfolio_value', result.portfolioValue, 'USD');
        await this.streamService.publishMetric(sessionId, 'total_return', (session.totalReturn ?? 0) * 100, 'percent');
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Tick processing error for session ${sessionId}: ${err.message}`, err.stack);

      const classifiedError = classifyError(error instanceof Error ? error : new Error(err.message));

      if (classifiedError instanceof UnrecoverableError) {
        // Unrecoverable errors should fail the session immediately
        this.logger.warn(`Session ${sessionId} encountered unrecoverable error, marking as failed`);
        await this.jobService.markFailed(sessionId, `Unrecoverable error: ${classifiedError.message}`);
        await this.streamService.publishStatus(sessionId, 'failed', 'unrecoverable_error', {
          errorMessage: classifiedError.message,
          errorType: 'unrecoverable'
        });
        this.engineService.clearThrottleState(sessionId);
        this.engineService.clearExitTracker(sessionId);
        if (typeof global.gc === 'function') {
          global.gc();
        }
        return;
      }

      // Recoverable errors - increment error count and potentially pause
      session.consecutiveErrors++;
      await this.sessionRepository.save(session);

      if (session.consecutiveErrors >= this.maxConsecutiveErrors) {
        await this.retryService.handleConsecutiveErrors(session, classifiedError.message);
      } else {
        await this.streamService.publishLog(
          sessionId,
          'warn',
          `Recoverable error (${session.consecutiveErrors}/${this.maxConsecutiveErrors}): ${classifiedError.message}`,
          {
            errorType: 'recoverable',
            consecutiveErrors: session.consecutiveErrors
          }
        );
      }
    } finally {
      endTimer();
    }
  }

  /**
   * Handle session stop - finalize metrics
   */
  private async handleStopSession(data: StopSessionJobData): Promise<void> {
    const { sessionId, reason } = data;
    this.logger.log(`Finalizing stopped session ${sessionId} (reason: ${reason})`);

    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
      relations: ['user', 'algorithm']
    });

    if (!session) {
      this.logger.error(`Session ${sessionId} not found`);
      return;
    }

    try {
      // Calculate final metrics
      const metrics = await this.engineService.calculateSessionMetrics(session);

      // Update session with final metrics
      session.sharpeRatio = metrics.sharpeRatio;
      session.winRate = metrics.winRate;
      session.totalTrades = metrics.totalTrades;
      session.winningTrades = metrics.winningTrades;
      session.losingTrades = metrics.losingTrades;
      session.maxDrawdown = metrics.maxDrawdown;
      await this.sessionRepository.save(session);

      // Record final metrics in Prometheus
      this.metricsService.recordBacktestFinalMetrics(session.algorithm?.id ?? 'unknown', {
        totalReturn: session.totalReturn ?? 0,
        sharpeRatio: metrics.sharpeRatio,
        maxDrawdown: metrics.maxDrawdown,
        tradeCount: metrics.totalTrades
      });

      // Emit final status
      await this.streamService.publishStatus(sessionId, session.status.toLowerCase(), reason, {
        metrics: {
          finalValue: session.currentPortfolioValue,
          totalReturn: session.totalReturn,
          sharpeRatio: metrics.sharpeRatio,
          maxDrawdown: metrics.maxDrawdown,
          totalTrades: metrics.totalTrades,
          winRate: metrics.winRate
        }
      });

      // Clean up in-memory throttle state, exit tracker, and trigger GC
      this.engineService.clearThrottleState(sessionId);
      this.engineService.clearExitTracker(sessionId);
      if (typeof global.gc === 'function') {
        global.gc();
      }

      this.logger.log(`Session ${sessionId} finalized successfully`);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to finalize session ${sessionId}: ${err.message}`, err.stack);
    }
  }

  /**
   * Handle pipeline notification - emit event to pipeline orchestrator
   * This is processed as a job for reliable delivery even if the process crashes
   */
  private async handleNotifyPipeline(data: NotifyPipelineJobData): Promise<void> {
    const { sessionId, pipelineId, stoppedReason } = data;
    this.logger.log(`Notifying pipeline ${pipelineId} about session ${sessionId} completion`);

    const session = await this.sessionRepository.findOne({
      where: { id: sessionId }
    });

    if (!session) {
      this.logger.warn(`Session ${sessionId} not found, skipping pipeline notification`);
      return;
    }

    const metrics = await this.jobService.calculateMetrics(session);

    this.eventEmitter.emit(PIPELINE_EVENTS.PAPER_TRADING_COMPLETED, {
      sessionId,
      pipelineId,
      metrics,
      stoppedReason
    });
  }

  /** Track a cleaned-up session, pruning the set when it exceeds the threshold to prevent memory leaks */
  private trackCleanedUpSession(sessionId: string): void {
    if (this.cleanedUpSessions.size >= MAX_CLEANUP_CACHE) {
      this.cleanedUpSessions.clear();
    }
    this.cleanedUpSessions.add(sessionId);
  }

  /** Restore throttle state from DB if not already in memory */
  private restoreThrottleStateIfNeeded(sessionId: string, session: PaperTradingSession): void {
    if (session.throttleState && !this.engineService.hasThrottleState(sessionId)) {
      this.engineService.restoreThrottleState(sessionId, session.throttleState);
      this.logger.log(`Restored throttle state from DB for session ${sessionId}`);
    }
  }
}
