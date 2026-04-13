import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { Repository } from 'typeorm';

import { SessionStatusResponse } from '@chansey/api-interfaces';

import { PaperTradingOrder, PaperTradingSession, PaperTradingStatus } from './entities';
import { PaperTradingEngineService } from './paper-trading-engine.service';
import { PaperTradingJobType, RetryTickJobData } from './paper-trading.job-data';

import { PIPELINE_EVENTS } from '../../pipeline/interfaces';
import { forceRemoveJob } from '../../shared/queue.util';

@Injectable()
export class PaperTradingJobService {
  private readonly logger = new Logger(PaperTradingJobService.name);

  constructor(
    @InjectRepository(PaperTradingSession)
    private readonly sessionRepository: Repository<PaperTradingSession>,
    @InjectRepository(PaperTradingOrder)
    private readonly orderRepository: Repository<PaperTradingOrder>,
    @InjectQueue('paper-trading')
    private readonly paperTradingQueue: Queue,
    private readonly eventEmitter: EventEmitter2,
    private readonly engineService: PaperTradingEngineService
  ) {}

  /**
   * Schedule a tick job for a session
   */
  async scheduleTickJob(sessionId: string, userId: string, intervalMs: number): Promise<void> {
    const jobId = `paper-trading-tick-${sessionId}`;

    // Use upsertJobScheduler so the scheduler key matches the jobId used by removeJobScheduler().
    // The legacy queue.add(name, data, { repeat, jobId }) stores schedulers under an MD5 hash key,
    // causing removeJobScheduler(jobId) to silently no-op.
    await this.paperTradingQueue.upsertJobScheduler(
      jobId,
      { every: intervalMs },
      { name: 'tick', data: { type: PaperTradingJobType.TICK, sessionId, userId } }
    );

    this.logger.debug(`Scheduled tick job ${jobId} with interval ${intervalMs}ms`);
  }

  /**
   * Schedule a one-shot delayed retry tick after backoff
   */
  async scheduleRetryTick(sessionId: string, userId: string, delayMs: number, retryAttempt: number): Promise<void> {
    const jobId = `paper-trading-retry-${sessionId}`;

    await forceRemoveJob(this.paperTradingQueue, jobId, this.logger);

    const jobData: RetryTickJobData = {
      type: PaperTradingJobType.RETRY_TICK,
      sessionId,
      userId,
      retryAttempt,
      delayMs
    };

    await this.paperTradingQueue.add('retry-tick', jobData, {
      delay: delayMs,
      jobId,
      removeOnComplete: true
    });

    this.logger.debug(`Scheduled retry tick ${jobId} with delay ${delayMs}ms (attempt ${retryAttempt})`);
  }

  /**
   * Remove tick jobs for a session
   */
  async removeTickJobs(sessionId: string): Promise<void> {
    const tickJobId = `paper-trading-tick-${sessionId}`;
    const retryJobId = `paper-trading-retry-${sessionId}`;

    try {
      // Use the new BullMQ v5+ API for removing job schedulers
      await this.paperTradingQueue.removeJobScheduler(tickJobId);
      this.logger.debug(`Removed tick job ${tickJobId}`);
    } catch (error: unknown) {
      // Job scheduler might not exist if session was never started
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes('Job scheduler') && !msg.includes('not found')) {
        this.logger.warn(`Failed to remove tick job ${tickJobId}: ${msg}`);
      }
    }

    // Also remove any pending retry job (no-op if it doesn't exist)
    await forceRemoveJob(this.paperTradingQueue, retryJobId, this.logger);
  }

  /**
   * Update session metrics (called by processor after each tick)
   */
  async updateSessionMetrics(
    sessionId: string,
    metrics: {
      currentPortfolioValue?: number;
      peakPortfolioValue?: number;
      maxDrawdown?: number;
      totalReturn?: number;
      sharpeRatio?: number;
      winRate?: number;
      totalTrades?: number;
      winningTrades?: number;
      losingTrades?: number;
      tickCount?: number;
      lastTickAt?: Date;
      consecutiveErrors?: number;
    }
  ): Promise<void> {
    await this.sessionRepository.update(sessionId, metrics);
  }

  /**
   * Mark session as failed
   */
  async markFailed(sessionId: string, errorMessage: string): Promise<void> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId }
    });

    await this.sessionRepository.update(sessionId, {
      status: PaperTradingStatus.FAILED,
      errorMessage,
      stoppedAt: new Date(),
      stoppedReason: 'error'
    });

    await this.cleanupSession(sessionId);

    // Emit event so the pipeline transitions to FAILED instead of staying RUNNING forever
    if (session?.pipelineId) {
      this.eventEmitter.emit(PIPELINE_EVENTS.PAPER_TRADING_FAILED, {
        sessionId,
        pipelineId: session.pipelineId,
        reason: errorMessage
      });
    }

    this.logger.error(`Paper trading session ${sessionId} marked as failed: ${errorMessage}`);
  }

  /**
   * Mark session as completed
   */
  async markCompleted(sessionId: string, reason: string): Promise<void> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
      relations: ['user']
    });

    if (!session) return;

    session.status = PaperTradingStatus.COMPLETED;
    session.completedAt = new Date();
    session.stoppedReason = reason;
    await this.sessionRepository.save(session);

    await this.cleanupSession(sessionId);

    // Emit event for pipeline orchestrator
    if (session.pipelineId) {
      const metrics = await this.calculateMetrics(session);
      this.eventEmitter.emit(PIPELINE_EVENTS.PAPER_TRADING_COMPLETED, {
        sessionId,
        pipelineId: session.pipelineId,
        metrics,
        stoppedReason: reason
      });
    }

    this.logger.log(`Paper trading session ${sessionId} completed: ${reason}`);
  }

  /**
   * Find all active sessions (for recovery)
   */
  async findActiveSessions(): Promise<PaperTradingSession[]> {
    return this.sessionRepository.find({
      where: { status: PaperTradingStatus.ACTIVE },
      relations: ['user']
    });
  }

  /**
   * Get session status for pipeline orchestrator
   */
  async getSessionStatus(sessionId: string): Promise<SessionStatusResponse> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
      relations: ['user']
    });

    if (!session) {
      throw new NotFoundException(`Paper trading session ${sessionId} not found`);
    }

    const metrics = await this.calculateMetrics(session);

    return {
      status: session.status,
      metrics,
      stoppedReason: session.stoppedReason
    };
  }

  /**
   * Clean up tick jobs and in-memory state for a session
   */
  private async cleanupSession(sessionId: string): Promise<void> {
    await this.removeTickJobs(sessionId);
    this.engineService.clearThrottleState(sessionId);
    this.engineService.clearExitTracker(sessionId);
  }

  /**
   * Calculate performance metrics for a session (self-contained, no circular dep)
   */
  async calculateMetrics(session: PaperTradingSession): Promise<SessionStatusResponse['metrics']> {
    const startTime = session.startedAt ?? session.createdAt;
    const endTime = session.stoppedAt ?? session.completedAt ?? new Date();
    const durationHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);

    const feeResult = await this.orderRepository
      .createQueryBuilder('order')
      .select('SUM(order.fee)', 'totalFees')
      .where('order.sessionId = :sessionId', { sessionId: session.id })
      .getRawOne();

    const currentValue = session.currentPortfolioValue ?? session.initialCapital;
    const totalReturn = currentValue - session.initialCapital;
    const totalReturnPercent = (totalReturn / session.initialCapital) * 100;

    return {
      initialCapital: session.initialCapital,
      currentPortfolioValue: currentValue,
      totalReturn,
      totalReturnPercent,
      maxDrawdown: session.maxDrawdown ?? 0,
      sharpeRatio: session.sharpeRatio,
      winRate: session.winRate ?? 0,
      totalTrades: session.totalTrades,
      winningTrades: session.winningTrades,
      losingTrades: session.losingTrades,
      totalFees: feeResult?.totalFees ?? 0,
      durationHours
    };
  }
}
