import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';

import Redis from 'ioredis';

import { toErrorInfo } from '../shared/error.util';
import { QUEUE_NAMES } from '../shutdown/queue-names.constant';

/**
 * Redis Maintenance Task
 *
 * Daily cleanup of stale BullMQ job data to prevent unbounded key growth.
 * Trims completed/failed sets, event streams, and orphaned job hashes.
 *
 * Runs at 4 AM UTC daily. Uses its own ioredis connection to db3 (BullMQ).
 *
 * Redis maxmemory recommendation (apply after one-time cleanup):
 *   CONFIG SET maxmemory 1073741824
 *   CONFIG SET maxmemory-policy volatile-lru
 *   CONFIG REWRITE
 * volatile-lru only evicts keys with TTLs, protecting BullMQ internals.
 */
@Injectable()
export class RedisMaintenanceTask implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisMaintenanceTask.name);
  private redis: Redis | null = null;
  private redisDb0: Redis | null = null;
  private running = false;

  private static readonly COMPLETED_KEEP = 200;
  private static readonly FAILED_KEEP = 100;
  private static readonly EVENT_STREAM_MAXLEN = 1000;
  private static readonly PIPELINE_BATCH_SIZE = 500;

  private static readonly TELEMETRY_STREAMS = ['backtest-telemetry', 'paper-trading-telemetry'];
  private static readonly TELEMETRY_MAXLEN = 5000;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.redis = new Redis({
      host: this.config.get('REDIS_HOST'),
      port: parseInt(this.config.get('REDIS_PORT') || '6379', 10),
      username: this.config.get('REDIS_USER'),
      password: this.config.get('REDIS_PASSWORD'),
      family: 0,
      db: 3,
      tls: this.config.get('REDIS_TLS') === 'true' ? {} : undefined,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      retryStrategy: (times: number) => Math.min(2 ** times * 100, 5000)
    });
    this.redis.on('error', (err) => {
      this.logger.error(`Redis maintenance connection error: ${err.message}`);
    });

    this.redisDb0 = new Redis({
      host: this.config.get('REDIS_HOST'),
      port: parseInt(this.config.get('REDIS_PORT') || '6379', 10),
      username: this.config.get('REDIS_USER'),
      password: this.config.get('REDIS_PASSWORD'),
      family: 0,
      db: 0,
      tls: this.config.get('REDIS_TLS') === 'true' ? {} : undefined,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      retryStrategy: (times: number) => Math.min(2 ** times * 100, 5000)
    });
    this.redisDb0.on('error', (err) => {
      this.logger.warn(`Redis db0 connection error: ${err.message}`);
    });
  }

  onModuleDestroy() {
    if (this.redis) {
      this.redis.disconnect();
      this.redis = null;
    }
    if (this.redisDb0) {
      this.redisDb0.disconnect();
      this.redisDb0 = null;
    }
  }

  /**
   * Daily maintenance at 4 AM UTC
   */
  @Cron('0 4 * * *', { timeZone: 'UTC' })
  async runMaintenance(): Promise<void> {
    if (!this.redis) {
      this.logger.warn('Redis connection not available, skipping maintenance');
      return;
    }

    if (this.running) {
      this.logger.warn('Maintenance already running, skipping');
      return;
    }

    this.running = true;
    try {
      this.logger.log('Starting Redis maintenance');
      const startTime = Date.now();
      let totalDeleted = 0;

      for (const queueName of QUEUE_NAMES) {
        try {
          const deleted = await this.trimQueue(queueName);
          totalDeleted += deleted;
        } catch (error: unknown) {
          const err = toErrorInfo(error);
          this.logger.error(`Failed to trim queue "${queueName}": ${err.message}`);
        }
      }

      // Trim telemetry streams on db0
      try {
        const telemetryTrimmed = await this.trimTelemetryStreams();
        totalDeleted += telemetryTrimmed;
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.error(`Failed to trim telemetry streams: ${err.message}`);
      }

      // Clean orphaned job keys
      try {
        const orphansDeleted = await this.cleanOrphanedKeys();
        totalDeleted += orphansDeleted;
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.error(`Failed to clean orphaned keys: ${err.message}`);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(`Redis maintenance complete: ${totalDeleted} keys removed in ${elapsed}s`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Trim completed and failed sets for a single queue, plus its event stream.
   */
  private async trimQueue(queueName: string): Promise<number> {
    if (!this.redis) return 0;

    const prefix = `bull:${queueName}`;
    let deleted = 0;

    // Trim completed set — keep newest N entries
    deleted += await this.trimSortedSet(`${prefix}:completed`, RedisMaintenanceTask.COMPLETED_KEEP);

    // Trim failed set — keep newest N entries
    deleted += await this.trimSortedSet(`${prefix}:failed`, RedisMaintenanceTask.FAILED_KEEP);

    // Trim event stream
    try {
      const streamKey = `${prefix}:events`;
      const exists = await this.redis.exists(streamKey);
      if (exists) {
        const lenBefore = await this.redis.xlen(streamKey);
        await this.redis.xtrim(streamKey, 'MAXLEN', '~', RedisMaintenanceTask.EVENT_STREAM_MAXLEN);
        const lenAfter = await this.redis.xlen(streamKey);
        deleted += lenBefore - lenAfter;
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to trim events for "${queueName}": ${err.message}`);
    }

    return deleted;
  }

  /**
   * Trim a sorted set by removing all but the highest-scoring (newest) N members.
   * Also deletes the corresponding job hash and log keys for removed members.
   */
  private async trimSortedSet(key: string, keep: number): Promise<number> {
    if (!this.redis) return 0;

    const total = await this.redis.zcard(key);
    if (total <= keep) return 0;

    const removeCount = total - keep;
    // Get the job IDs that will be removed (lowest scores = oldest)
    const jobIds = await this.redis.zrange(key, 0, removeCount - 1);

    if (jobIds.length === 0) return 0;

    // Remove from sorted set
    await this.redis.zremrangebyrank(key, 0, removeCount - 1);

    // Delete corresponding job hashes and logs in batches
    const queuePrefix = key.replace(/:(?:completed|failed)$/, '');
    let keysDeleted = 0;

    for (let i = 0; i < jobIds.length; i += RedisMaintenanceTask.PIPELINE_BATCH_SIZE) {
      const batch = jobIds.slice(i, i + RedisMaintenanceTask.PIPELINE_BATCH_SIZE);
      const pipeline = this.redis.pipeline();
      for (const id of batch) {
        pipeline.del(`${queuePrefix}:${id}`);
        pipeline.del(`${queuePrefix}:${id}:logs`);
      }
      const results = await pipeline.exec();
      if (results) {
        keysDeleted += results.filter(([err, val]) => !err && val === 1).length;
      }
    }

    return keysDeleted;
  }

  /**
   * Trim telemetry streams on db0.
   * Uses persistent db0 connection initialized in onModuleInit().
   */
  private async trimTelemetryStreams(): Promise<number> {
    if (!this.redisDb0) return 0;

    let trimmed = 0;

    for (const stream of RedisMaintenanceTask.TELEMETRY_STREAMS) {
      try {
        const exists = await this.redisDb0.exists(stream);
        if (!exists) continue;

        const lenBefore = await this.redisDb0.xlen(stream);
        await this.redisDb0.xtrim(stream, 'MAXLEN', '~', RedisMaintenanceTask.TELEMETRY_MAXLEN);
        const lenAfter = await this.redisDb0.xlen(stream);
        trimmed += lenBefore - lenAfter;
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.warn(`Failed to trim telemetry stream "${stream}": ${err.message}`);
      }
    }

    return trimmed;
  }

  /**
   * Scan for orphaned job hash keys that aren't in any queue's active/waiting/delayed/completed/failed/paused/prioritized sets.
   * Uses SCAN to avoid blocking Redis.
   */
  private async cleanOrphanedKeys(): Promise<number> {
    if (!this.redis) return 0;

    let deleted = 0;
    const knownPrefixes = QUEUE_NAMES.map((q) => `bull:${q}:`);

    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', 'bull:*', 'COUNT', 200);
      cursor = nextCursor;

      // Filter for job hash keys (pattern: bull:<queue>:<numeric-id>)
      const jobHashKeys = keys.filter((k) => {
        // Must match a known queue prefix
        const matchedPrefix = knownPrefixes.find((p) => k.startsWith(p));
        if (!matchedPrefix) return false;
        const suffix = k.slice(matchedPrefix.length);
        // Job hashes are purely numeric IDs (no colons)
        return /^\d+$/.test(suffix);
      });

      if (jobHashKeys.length === 0) continue;

      // Check if each job hash has a corresponding entry in any state set (batched via pipeline)
      const toDelete: string[] = [];
      const jobMeta = jobHashKeys.map((jobKey) => {
        const parts = jobKey.split(':');
        const jobId = parts[parts.length - 1];
        const queuePrefix = parts.slice(0, -1).join(':');
        return { jobKey, jobId, queuePrefix };
      });

      const pipeline = this.redis.pipeline();
      for (const { jobId, queuePrefix } of jobMeta) {
        pipeline.lpos(`${queuePrefix}:active`, jobId);
        pipeline.lpos(`${queuePrefix}:wait`, jobId);
        pipeline.zscore(`${queuePrefix}:delayed`, jobId);
        pipeline.zscore(`${queuePrefix}:completed`, jobId);
        pipeline.zscore(`${queuePrefix}:failed`, jobId);
        pipeline.lpos(`${queuePrefix}:paused`, jobId);
        pipeline.zscore(`${queuePrefix}:prioritized`, jobId);
      }
      const results = await pipeline.exec();

      if (results) {
        for (let j = 0; j < jobMeta.length; j++) {
          const base = j * 7;
          const allNull =
            results[base][1] === null &&
            results[base + 1][1] === null &&
            results[base + 2][1] === null &&
            results[base + 3][1] === null &&
            results[base + 4][1] === null &&
            results[base + 5][1] === null &&
            results[base + 6][1] === null;
          if (allNull) {
            toDelete.push(jobMeta[j].jobKey);
            toDelete.push(`${jobMeta[j].jobKey}:logs`);
          }
        }
      }

      // Batch delete orphans
      for (let i = 0; i < toDelete.length; i += RedisMaintenanceTask.PIPELINE_BATCH_SIZE) {
        const batch = toDelete.slice(i, i + RedisMaintenanceTask.PIPELINE_BATCH_SIZE);
        const pipeline = this.redis.pipeline();
        for (const key of batch) {
          pipeline.del(key);
        }
        const results = await pipeline.exec();
        if (results) {
          deleted += results.filter(([err, val]) => !err && val === 1).length;
        }
      }
    } while (cursor !== '0');

    if (deleted > 0) {
      this.logger.log(`Cleaned ${deleted} orphaned job keys`);
    }

    return deleted;
  }
}
