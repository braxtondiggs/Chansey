import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { Queue, RedisClient } from 'bullmq';

import { backtestConfig } from './backtest.config';

import { toErrorInfo } from '../../shared/error.util';

/** Redis key prefix for pause flags */
const PAUSE_KEY_PREFIX = 'backtest:pause:';

/**
 * Default TTL for pause flags in seconds (1 hour).
 * Can be overridden via BACKTEST_PAUSE_TTL_SECONDS environment variable.
 */
const DEFAULT_PAUSE_KEY_TTL_SECONDS = 60 * 60;

const BACKTEST_QUEUE_NAMES = backtestConfig();

/**
 * Result of a pause flag operation.
 */
export interface PauseFlagResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Error message if operation failed */
  error?: string;
}

/**
 * Service for managing backtest pause flags via Redis.
 * Uses the shared BullMQ Redis connection for efficient resource utilization.
 * Used by LiveReplayProcessor and BacktestService to coordinate pause/resume.
 *
 * ## Error Handling Behavior
 *
 * - `setPauseFlag`: Throws error if Redis unavailable (user action requires confirmation)
 * - `isPauseRequested`: Returns false if Redis unavailable (safe default for processor)
 * - `clearPauseFlag`: Fails silently if Redis unavailable (flag has TTL and will expire)
 *
 * Use `isAvailable()` to check Redis connectivity before operations that require it.
 */
@Injectable()
export class BacktestPauseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BacktestPauseService.name);
  private redis: RedisClient | null = null;
  private readonly pauseKeyTtl: number;

  constructor(@InjectQueue(BACKTEST_QUEUE_NAMES.replayQueue) private readonly queue: Queue) {
    // Allow TTL configuration via environment variable
    const envTtl = process.env.BACKTEST_PAUSE_TTL_SECONDS;
    this.pauseKeyTtl = envTtl ? parseInt(envTtl, 10) : DEFAULT_PAUSE_KEY_TTL_SECONDS;
  }

  async onModuleInit() {
    // Access the shared Redis client from the BullMQ queue
    // This reuses the existing connection pool instead of creating a new one
    try {
      this.redis = await this.queue.client;
      this.logger.log('BacktestPauseService initialized with shared BullMQ Redis connection');
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to get shared Redis client: ${err.message}. Service will operate in degraded mode.`);
    }
  }

  async onModuleDestroy() {
    // Don't close the connection - it's managed by BullMQ
    this.redis = null;
    this.logger.log('BacktestPauseService cleaned up');
  }

  /**
   * Check if Redis connection is available.
   * Use this before operations that require Redis connectivity.
   *
   * @returns True if Redis is connected and available
   */
  isAvailable(): boolean {
    return this.redis !== null;
  }

  /**
   * Set pause flag for a backtest.
   * The processor will check this flag and pause at the next checkpoint.
   *
   * @param backtestId - ID of the backtest to pause
   * @throws Error if Redis connection is not available
   * @throws Error if the Redis SET operation fails
   */
  async setPauseFlag(backtestId: string): Promise<void> {
    if (!this.redis) {
      const error = `Cannot set pause flag for ${backtestId}: Redis not available`;
      this.logger.error(error);
      throw new Error('Redis connection not available');
    }

    try {
      await this.redis.set(`${PAUSE_KEY_PREFIX}${backtestId}`, 'true', 'EX', this.pauseKeyTtl);
      this.logger.debug(`Pause flag set for backtest ${backtestId} (TTL: ${this.pauseKeyTtl}s)`);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to set pause flag for ${backtestId}: ${err.message}`);
      throw error;
    }
  }

  /**
   * Set pause flag with result object (non-throwing variant).
   * Useful when you want to handle errors without try/catch.
   *
   * @param backtestId - ID of the backtest to pause
   * @returns Result object indicating success or failure
   */
  async trySetPauseFlag(backtestId: string): Promise<PauseFlagResult> {
    try {
      await this.setPauseFlag(backtestId);
      return { success: true };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      return { success: false, error: err.message };
    }
  }

  /**
   * Check if pause is requested for a backtest.
   * Returns false if Redis is unavailable (safe default to continue processing).
   *
   * @param backtestId - ID of the backtest to check
   * @returns True if pause is requested, false otherwise (including Redis failures)
   */
  async isPauseRequested(backtestId: string): Promise<boolean> {
    if (!this.redis) {
      // Safe default: continue processing if we can't check pause status
      this.logger.warn(`Cannot check pause flag for ${backtestId}: Redis not available`);
      return false;
    }

    try {
      const value = await this.redis.get(`${PAUSE_KEY_PREFIX}${backtestId}`);
      return value === 'true';
    } catch (error: unknown) {
      // Safe default: continue processing if we can't check pause status
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to check pause flag for ${backtestId}: ${err.message}`);
      return false;
    }
  }

  /**
   * Clear pause flag for a backtest.
   * Fails silently if Redis is unavailable since the flag has a TTL and will expire.
   *
   * @param backtestId - ID of the backtest to clear the flag for
   * @returns Result object indicating success or failure
   */
  async clearPauseFlag(backtestId: string): Promise<PauseFlagResult> {
    if (!this.redis) {
      // Flag will expire due to TTL if not cleared
      const error = `Cannot clear pause flag for ${backtestId}: Redis not available`;
      this.logger.warn(error);
      return { success: false, error };
    }

    try {
      await this.redis.del(`${PAUSE_KEY_PREFIX}${backtestId}`);
      this.logger.debug(`Pause flag cleared for backtest ${backtestId}`);
      return { success: true };
    } catch (error: unknown) {
      // Flag will expire due to TTL if not cleared
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to clear pause flag for ${backtestId}: ${err.message}`);
      return { success: false, error: err.message };
    }
  }
}
