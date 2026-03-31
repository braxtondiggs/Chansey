import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { Job } from 'bullmq';
import { Repository } from 'typeorm';

import { PaperTradingSession, PaperTradingStatus } from './entities';
import { PaperTradingEngineService } from './paper-trading-engine.service';
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
import { PaperTradingService } from './paper-trading.service';

import { ExchangeKey } from '../../exchange/exchange-key/exchange-key.entity';
import { MetricsService } from '../../metrics/metrics.service';
import { toErrorInfo } from '../../shared/error.util';

const MAX_RETRY_DELAY_MS = 30 * 60 * 1000; // 30 minutes
const MAX_CLEANUP_CACHE = 500;

// Error types for classification
class RecoverableError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'RecoverableError';
  }
}

class UnrecoverableError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'UnrecoverableError';
  }
}

/**
 * Classify an error and wrap it in the appropriate error class.
 * Returns a RecoverableError or UnrecoverableError based on error characteristics.
 */
function classifyError(error: Error): RecoverableError | UnrecoverableError {
  const errorMessage = error.message?.toLowerCase() ?? '';
  const errorName = error.name?.toLowerCase() ?? '';

  // Configuration and authentication errors are unrecoverable
  if (
    errorMessage.includes('invalid api key') ||
    errorMessage.includes('authentication') ||
    errorMessage.includes('unauthorized') ||
    errorMessage.includes('forbidden') ||
    errorMessage.includes('401') ||
    errorMessage.includes('403') ||
    errorMessage.includes('not found') ||
    errorMessage.includes('algorithm') ||
    errorMessage.includes('configuration') ||
    errorMessage.includes('invalid parameter')
  ) {
    return new UnrecoverableError(error.message, error);
  }

  // Network and rate limit errors are recoverable
  if (
    errorName.includes('network') ||
    errorName.includes('timeout') ||
    errorMessage.includes('network') ||
    errorMessage.includes('timeout') ||
    errorMessage.includes('econnrefused') ||
    errorMessage.includes('enotfound') ||
    errorMessage.includes('rate limit') ||
    errorMessage.includes('too many requests') ||
    errorMessage.includes('429') ||
    errorMessage.includes('503') ||
    errorMessage.includes('502') ||
    errorMessage.includes('temporarily unavailable')
  ) {
    return new RecoverableError(error.message, error);
  }

  // Default to recoverable for unknown errors
  return new RecoverableError(error.message, error);
}

@Injectable()
@Processor('paper-trading')
export class PaperTradingProcessor extends WorkerHost {
  private readonly logger = new Logger(PaperTradingProcessor.name);
  private readonly maxConsecutiveErrors: number;
  private readonly maxRetryAttempts: number;
  private readonly retryBackoffMs: number;
  private readonly cleanedUpSessions = new Set<string>();

  constructor(
    @Inject(paperTradingConfig.KEY) private readonly config: ConfigType<typeof paperTradingConfig>,
    @InjectRepository(PaperTradingSession)
    private readonly sessionRepository: Repository<PaperTradingSession>,
    @InjectRepository(ExchangeKey)
    private readonly exchangeKeyRepository: Repository<ExchangeKey>,
    private readonly paperTradingService: PaperTradingService,
    private readonly engineService: PaperTradingEngineService,
    private readonly streamService: PaperTradingStreamService,
    private readonly metricsService: MetricsService,
    private readonly eventEmitter: EventEmitter2
  ) {
    super();
    this.maxConsecutiveErrors = config.maxConsecutiveErrors;
    this.maxRetryAttempts = config.maxRetryAttempts;
    this.retryBackoffMs = config.retryBackoffMs;
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
        await this.handleRetryTick(job.data as RetryTickJobData);
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
      await this.paperTradingService.scheduleTickJob(sessionId, userId, session.tickIntervalMs);

      this.logger.log(`Session ${sessionId} started successfully, tick jobs scheduled`);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to start session ${sessionId}: ${err.message}`, err.stack);
      await this.paperTradingService.markFailed(sessionId, err.message);
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
        await this.paperTradingService.removeTickJobs(sessionId);
        this.trackCleanedUpSession(sessionId);
      }
      return;
    }

    // Actively stop ticks if externally marked as FAILED
    if (session.status === PaperTradingStatus.FAILED) {
      if (!this.cleanedUpSessions.has(sessionId)) {
        this.logger.warn(`Session ${sessionId} was externally marked as FAILED, removing tick jobs`);
        await this.paperTradingService.removeTickJobs(sessionId);
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
          await this.pauseSessionDueToErrors(session, result.errors.join('; '));
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

      // Apply successful tick result (reset counters, update metrics, save)
      const currentDrawdown = await this.applySuccessfulTickResult(session, result);

      // Stop-condition precedence (order matters):
      //   1. Safety overrides first — maxDrawdown / targetReturn protect capital
      //   2. Min-trades gate — ensures statistical significance before graduation
      //   3. Duration cap — hard time limit prevents runaway sessions
      // Each check short-circuits by verifying session.status === ACTIVE,
      // so the first triggered condition wins.
      await this.checkStopConditions(session, result.portfolioValue, currentDrawdown);
      await this.checkMinTrades(session);
      await this.checkDuration(session);

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
        await this.paperTradingService.markFailed(sessionId, `Unrecoverable error: ${classifiedError.message}`);
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
        await this.pauseSessionDueToErrors(session, classifiedError.message);
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

    this.eventEmitter.emit('paper-trading.completed', {
      sessionId,
      pipelineId,
      stoppedReason
    });
  }

  /**
   * Check if stop conditions are met
   */
  private async checkStopConditions(
    session: PaperTradingSession,
    portfolioValue: number,
    currentDrawdown: number
  ): Promise<void> {
    if (session.status !== PaperTradingStatus.ACTIVE) return;
    if (!session.stopConditions) return;

    const { maxDrawdown, targetReturn } = session.stopConditions;

    if (maxDrawdown !== undefined && currentDrawdown > maxDrawdown) {
      this.logger.log(`Session ${session.id} hit max drawdown limit (${(currentDrawdown * 100).toFixed(2)}%)`);
      await this.paperTradingService.markCompleted(session.id, 'max_drawdown');
      session.status = PaperTradingStatus.COMPLETED;
      return;
    }

    const currentReturn = (portfolioValue - session.initialCapital) / session.initialCapital;
    if (targetReturn !== undefined && currentReturn >= targetReturn) {
      this.logger.log(`Session ${session.id} hit target return (${(currentReturn * 100).toFixed(2)}%)`);
      await this.paperTradingService.markCompleted(session.id, 'target_reached');
      session.status = PaperTradingStatus.COMPLETED;
      return;
    }
  }

  /**
   * Check if minimum trade count gate is met
   */
  private async checkMinTrades(session: PaperTradingSession): Promise<void> {
    if (session.status !== PaperTradingStatus.ACTIVE) return;
    if (session.minTrades == null) return;

    if (session.totalTrades >= session.minTrades) {
      this.logger.log(
        `Session ${session.id} reached minimum trade count (${session.totalTrades}/${session.minTrades})`
      );
      await this.paperTradingService.markCompleted(session.id, 'min_trades_reached');
      session.status = PaperTradingStatus.COMPLETED;
    }
  }

  /**
   * Check if duration limit is reached (hard time cap)
   */
  private async checkDuration(session: PaperTradingSession): Promise<void> {
    if (session.status !== PaperTradingStatus.ACTIVE) return;
    if (!session.duration || !session.startedAt) return;

    const startTime = session.startedAt.getTime();
    const now = Date.now();
    const durationMs = this.parseDuration(session.duration);

    if (now - startTime >= durationMs) {
      this.logger.log(`Session ${session.id} reached duration limit (${session.duration})`);
      await this.paperTradingService.markCompleted(session.id, 'duration_reached');
      session.status = PaperTradingStatus.COMPLETED;
    }
  }

  /**
   * Parse duration string to milliseconds
   */
  private parseDuration(duration: string): number {
    const match = duration.match(/^(\d+)([smhdwMy])$/);
    if (!match) return 0;

    const value = parseInt(match[1], 10);
    const unit = match[2];

    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
      w: 7 * 24 * 60 * 60 * 1000,
      M: 30 * 24 * 60 * 60 * 1000,
      y: 365 * 24 * 60 * 60 * 1000
    };

    return value * (multipliers[unit] ?? 0);
  }

  /**
   * Apply successful tick result to session — shared by handleTick and handleRetryTick
   */
  private async applySuccessfulTickResult(
    session: PaperTradingSession,
    result: { portfolioValue: number; ordersExecuted: number }
  ): Promise<number> {
    session.consecutiveErrors = 0;
    session.retryAttempts = 0;
    session.tickCount++;
    session.lastTickAt = new Date();
    session.currentPortfolioValue = result.portfolioValue;

    if (result.ordersExecuted > 0) {
      session.totalTrades = (session.totalTrades ?? 0) + result.ordersExecuted;
    }

    if (result.portfolioValue > (session.peakPortfolioValue ?? session.initialCapital)) {
      session.peakPortfolioValue = result.portfolioValue;
    }

    const currentDrawdown =
      (session.peakPortfolioValue ?? 0) > 0
        ? ((session.peakPortfolioValue ?? 0) - result.portfolioValue) / (session.peakPortfolioValue ?? 0)
        : 0;

    if (currentDrawdown > (session.maxDrawdown ?? 0)) {
      session.maxDrawdown = currentDrawdown;
    }

    session.totalReturn = (result.portfolioValue - session.initialCapital) / session.initialCapital;
    await this.sessionRepository.save(session);

    return currentDrawdown;
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

  /** Handle retry tick - attempt a single tick after backoff delay */
  private async handleRetryTick(data: RetryTickJobData): Promise<void> {
    const { sessionId, retryAttempt } = data;

    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
      relations: ['algorithm', 'exchangeKey', 'exchangeKey.exchange', 'user']
    });

    if (!session) {
      this.logger.warn(`Session ${sessionId} not found during retry tick`);
      return;
    }

    if (session.status !== PaperTradingStatus.ACTIVE) {
      this.logger.debug(`Session ${sessionId} is no longer active (status: ${session.status}), skipping retry`);
      return;
    }

    this.logger.log(`Retry tick ${retryAttempt}/${this.maxRetryAttempts} for session ${sessionId}`);

    this.restoreThrottleStateIfNeeded(sessionId, session);

    const endTimer = this.metricsService.startBacktestTimer('paper-trading');

    try {
      const result = await this.engineService.processTick(session, session.exchangeKey);

      if (result.processed) {
        // Clear error message before save (applySuccessfulTickResult saves the session)
        session.errorMessage = undefined;
        const currentDrawdown = await this.applySuccessfulTickResult(session, result);

        // Check stop conditions before rescheduling (may complete the session)
        await this.checkStopConditions(session, result.portfolioValue, currentDrawdown);
        await this.checkMinTrades(session);
        await this.checkDuration(session);

        // Re-schedule normal repeating tick job
        if (!session.user?.id) {
          throw new Error(`User not loaded for session ${sessionId}, cannot schedule tick job.`);
        }
        await this.paperTradingService.scheduleTickJob(sessionId, session.user.id, session.tickIntervalMs);

        await this.streamService.publishStatus(sessionId, 'active', 'retry_recovered', {
          retryAttempt,
          portfolioValue: result.portfolioValue
        });

        this.logger.log(`Session ${sessionId} recovered after retry ${retryAttempt}, normal ticks resumed`);
      } else {
        // Tick processed but failed — trigger next retry or permanent pause
        await this.pauseSessionDueToErrors(session, result.errors.join('; '));
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Retry tick error for session ${sessionId}: ${err.message}`, err.stack);

      const classifiedError = classifyError(error instanceof Error ? error : new Error(err.message));

      if (classifiedError instanceof UnrecoverableError) {
        await this.paperTradingService.markFailed(sessionId, `Unrecoverable error: ${classifiedError.message}`);
        await this.streamService.publishStatus(sessionId, 'failed', 'unrecoverable_error', {
          errorMessage: classifiedError.message,
          errorType: 'unrecoverable'
        });
        this.engineService.clearThrottleState(sessionId);
        this.engineService.clearExitTracker(sessionId);
        return;
      }

      await this.pauseSessionDueToErrors(session, classifiedError.message);
    } finally {
      endTimer();
    }
  }

  /**
   * Pause session due to consecutive errors, with exponential backoff retry
   */
  private async pauseSessionDueToErrors(session: PaperTradingSession, errorMessage: string): Promise<void> {
    if (session.retryAttempts < this.maxRetryAttempts) {
      // Schedule retry with exponential backoff
      const delay = Math.min(this.retryBackoffMs * Math.pow(2, session.retryAttempts), MAX_RETRY_DELAY_MS);
      session.retryAttempts++;
      session.consecutiveErrors = 0;
      session.errorMessage = `Retry ${session.retryAttempts}/${this.maxRetryAttempts} scheduled (${delay / 1000}s): ${errorMessage}`;
      await this.sessionRepository.save(session);

      // Remove repeating tick scheduler — the retry job will re-schedule it on success
      await this.paperTradingService.removeTickJobs(session.id);

      // Queue one-shot delayed retry
      if (!session.user?.id) {
        throw new Error(`User not loaded for session ${session.id}, cannot schedule retry tick.`);
      }
      await this.paperTradingService.scheduleRetryTick(session.id, session.user.id, delay, session.retryAttempts);

      await this.streamService.publishStatus(session.id, 'retry_scheduled', 'consecutive_errors', {
        errorMessage,
        retryAttempt: session.retryAttempts,
        delayMs: delay
      });

      this.logger.warn(
        `Session ${session.id} scheduling retry ${session.retryAttempts}/${this.maxRetryAttempts} in ${delay / 1000}s`
      );
      return;
    }

    // Exhausted retries — permanent pause
    session.status = PaperTradingStatus.PAUSED;
    session.pausedAt = new Date();
    session.retryAttempts = 0;
    session.errorMessage = `Auto-paused after ${this.maxRetryAttempts} retry attempts: ${errorMessage}`;
    await this.sessionRepository.save(session);

    await this.paperTradingService.removeTickJobs(session.id);

    // Clear throttle and exit tracker state so resumed sessions start fresh
    this.engineService.clearThrottleState(session.id);
    this.engineService.clearExitTracker(session.id);

    await this.streamService.publishStatus(session.id, 'paused', 'consecutive_errors', {
      errorMessage,
      consecutiveErrors: session.consecutiveErrors,
      retriesExhausted: true
    });

    this.logger.warn(`Session ${session.id} auto-paused after exhausting ${this.maxRetryAttempts} retry attempts`);
  }
}
