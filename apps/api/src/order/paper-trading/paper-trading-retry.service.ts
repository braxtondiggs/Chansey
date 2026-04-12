import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { PaperTradingSession, PaperTradingStatus } from './entities';
import { PaperTradingEngineService } from './paper-trading-engine.service';
import { classifyError, UnrecoverableError } from './paper-trading-error-classifier.util';
import { PaperTradingJobService } from './paper-trading-job.service';
import { applySuccessfulTickResult, evaluateStopReason } from './paper-trading-session.util';
import { PaperTradingStreamService } from './paper-trading-stream.service';
import { paperTradingConfig } from './paper-trading.config';
import { RetryTickJobData } from './paper-trading.job-data';

import { MetricsService } from '../../metrics/metrics.service';
import { toErrorInfo } from '../../shared/error.util';

const MAX_RETRY_DELAY_MS = 30 * 60 * 1000; // 30 minutes

@Injectable()
export class PaperTradingRetryService {
  private readonly logger = new Logger(PaperTradingRetryService.name);
  private readonly maxRetryAttempts: number;
  private readonly retryBackoffMs: number;

  constructor(
    @Inject(paperTradingConfig.KEY) config: ConfigType<typeof paperTradingConfig>,
    @InjectRepository(PaperTradingSession)
    private readonly sessionRepository: Repository<PaperTradingSession>,
    private readonly jobService: PaperTradingJobService,
    private readonly engineService: PaperTradingEngineService,
    private readonly streamService: PaperTradingStreamService,
    private readonly metricsService: MetricsService
  ) {
    this.maxRetryAttempts = config.maxRetryAttempts;
    this.retryBackoffMs = config.retryBackoffMs;
  }

  /** Handle retry tick - attempt a single tick after backoff delay */
  async handleRetryTick(data: RetryTickJobData): Promise<void> {
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

    if (session.throttleState && !this.engineService.hasThrottleState(sessionId)) {
      this.engineService.restoreThrottleState(sessionId, session.throttleState);
      this.logger.log(`Restored throttle state from DB for session ${sessionId}`);
    }

    const endTimer = this.metricsService.startBacktestTimer('paper-trading');

    try {
      const result = await this.engineService.processTick(session, session.exchangeKey);

      if (result.processed) {
        // Clear error message before save
        session.errorMessage = undefined;
        const currentDrawdown = applySuccessfulTickResult(session, result);
        await this.sessionRepository.save(session);

        // Check stop conditions before rescheduling (may complete the session)
        const stopReason = evaluateStopReason(session, result.portfolioValue, currentDrawdown);
        if (stopReason) {
          this.logger.log(`Session ${session.id} stop condition triggered: ${stopReason}`);
          await this.jobService.markCompleted(session.id, stopReason);
          session.status = PaperTradingStatus.COMPLETED;
        } else {
          // Re-schedule normal repeating tick job
          if (!session.user?.id) {
            throw new Error(`User not loaded for session ${sessionId}, cannot schedule tick job.`);
          }
          await this.jobService.scheduleTickJob(sessionId, session.user.id, session.tickIntervalMs);

          await this.streamService.publishStatus(sessionId, 'active', 'retry_recovered', {
            retryAttempt,
            portfolioValue: result.portfolioValue
          });

          this.logger.log(`Session ${sessionId} recovered after retry ${retryAttempt}, normal ticks resumed`);
        }
      } else {
        // Tick processed but failed — trigger next retry or permanent pause
        await this.pauseSessionDueToErrors(session, result.errors.join('; '));
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Retry tick error for session ${sessionId}: ${err.message}`, err.stack);

      const classifiedError = classifyError(error instanceof Error ? error : new Error(err.message));

      if (classifiedError instanceof UnrecoverableError) {
        await this.jobService.markFailed(sessionId, `Unrecoverable error: ${classifiedError.message}`);
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
   * Pause session due to consecutive errors, with exponential backoff retry.
   */
  async pauseSessionDueToErrors(session: PaperTradingSession, errorMessage: string): Promise<void> {
    if (session.retryAttempts < this.maxRetryAttempts) {
      // Schedule retry with exponential backoff
      const delay = Math.min(this.retryBackoffMs * Math.pow(2, session.retryAttempts), MAX_RETRY_DELAY_MS);
      session.retryAttempts++;
      session.consecutiveErrors = 0;
      session.errorMessage = `Retry ${session.retryAttempts}/${this.maxRetryAttempts} scheduled (${delay / 1000}s): ${errorMessage}`;
      await this.sessionRepository.save(session);

      // Remove repeating tick scheduler — the retry job will re-schedule it on success
      await this.jobService.removeTickJobs(session.id);

      // Queue one-shot delayed retry
      if (!session.user?.id) {
        throw new Error(`User not loaded for session ${session.id}, cannot schedule retry tick.`);
      }
      await this.jobService.scheduleRetryTick(session.id, session.user.id, delay, session.retryAttempts);

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

    await this.jobService.removeTickJobs(session.id);

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
