import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import Redis from 'ioredis';

import { randomUUID } from 'crypto';

import { LOCK_DEFAULTS, LOCK_REDIS_DB } from './distributed-lock.constants';

export interface LockOptions {
  key: string;
  ttlMs: number;
  retryDelayMs?: number;
  maxRetries?: number;
}

export interface LockResult {
  acquired: boolean;
  lockId: string | null;
}

export interface LockInfo {
  exists: boolean;
  lockId: string | null;
  ttlMs: number | null;
}

@Injectable()
export class DistributedLockService implements OnModuleDestroy {
  private readonly logger = new Logger(DistributedLockService.name);
  private readonly redis: Redis;

  // Lua script for safe release (only delete if we own the lock)
  private readonly RELEASE_SCRIPT = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;

  // Lua script to extend TTL only if we own the lock
  private readonly EXTEND_SCRIPT = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("pexpire", KEYS[1], ARGV[2])
    else
      return 0
    end
  `;

  constructor(private readonly configService: ConfigService) {
    this.redis = new Redis({
      host: this.configService.get<string>('REDIS_HOST'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      db: LOCK_REDIS_DB,
      username: this.configService.get<string>('REDIS_USER') || undefined,
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
      tls: this.configService.get<string>('REDIS_TLS') === 'true' ? {} : undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false
    });
  }

  /**
   * Attempts to acquire a distributed lock.
   * Uses Redis SET NX PX for atomic set-if-not-exists with expiration.
   */
  async acquire(options: LockOptions): Promise<LockResult> {
    const {
      key,
      ttlMs,
      retryDelayMs = LOCK_DEFAULTS.DEFAULT_RETRY_DELAY_MS,
      maxRetries = LOCK_DEFAULTS.DEFAULT_MAX_RETRIES
    } = options;
    const lockId = randomUUID();
    const attemptsAllowed = Math.max(0, maxRetries);

    for (let attempt = 0; attempt <= attemptsAllowed; attempt++) {
      try {
        // SET key lockId NX PX ttlMs
        const result = await this.redis.set(key, lockId, 'PX', ttlMs, 'NX');

        if (result === 'OK') {
          this.logger.debug(`Lock acquired: ${key} (lockId: ${lockId.substring(0, 8)}...)`);
          return { acquired: true, lockId };
        }
      } catch (error) {
        this.logger.error(`Failed to acquire lock ${key}: ${error.message}`);
        return { acquired: false, lockId: null };
      }

      if (attempt < attemptsAllowed) {
        await this.sleep(retryDelayMs);
      }
    }

    this.logger.debug(`Lock not acquired: ${key} (already held by another instance)`);
    return { acquired: false, lockId: null };
  }

  /**
   * Releases a distributed lock.
   * Uses Lua script to ensure only the lock owner can release it.
   */
  async release(key: string, lockId: string | null): Promise<boolean> {
    if (!lockId) {
      this.logger.warn(`Cannot release lock ${key}: no lockId provided`);
      return false;
    }

    try {
      const result = await this.redis.eval(this.RELEASE_SCRIPT, 1, key, lockId);
      const released = result === 1;

      if (released) {
        this.logger.debug(`Lock released: ${key}`);
      } else {
        this.logger.warn(`Lock ${key} not released: ownership mismatch or already expired`);
      }

      return released;
    } catch (error) {
      this.logger.error(`Failed to release lock ${key}: ${error.message}`);
      return false;
    }
  }

  /**
   * Gets information about a lock.
   */
  async getLockInfo(key: string): Promise<LockInfo> {
    try {
      const [lockId, ttl] = await Promise.all([this.redis.get(key), this.redis.pttl(key)]);

      return {
        exists: lockId !== null,
        lockId,
        ttlMs: ttl > 0 ? ttl : null
      };
    } catch (error) {
      this.logger.error(`Failed to get lock info for ${key}: ${error.message}`);
      return { exists: false, lockId: null, ttlMs: null };
    }
  }

  /**
   * Extends the TTL of a lock if we still own it.
   */
  async extend(key: string, lockId: string, ttlMs: number): Promise<boolean> {
    try {
      const result = await this.redis.eval(this.EXTEND_SCRIPT, 1, key, lockId, ttlMs);
      return result === 1;
    } catch (error) {
      this.logger.error(`Failed to extend lock ${key}: ${error.message}`);
      return false;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
      this.logger.log('Distributed lock Redis connection closed');
    } catch (error) {
      this.logger.warn(`Error closing Redis connection: ${error.message}`);
      this.redis.disconnect();
    }
  }
}
