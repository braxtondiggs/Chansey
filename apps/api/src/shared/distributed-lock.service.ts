import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import Redis from 'ioredis';

import { randomUUID } from 'crypto';
import * as os from 'os';

import { LOCK_DEFAULTS } from './distributed-lock.constants';
import { toErrorInfo } from './error.util';
import { LOCK_REDIS } from './lock-redis.provider';

export interface LockOptions {
  key: string;
  ttlMs: number;
  retryDelayMs?: number;
  maxRetries?: number;
}

export interface LockResult {
  acquired: boolean;
  // Stable UUID identifying this acquisition. Safe to expose externally
  // (e.g. LiveTradingService.getStatus().instanceId).
  lockId: string | null;
  // Opaque token — full JSON payload stored in Redis. Must be passed back
  // verbatim to release()/extend() so the ownership-check Lua script can
  // match it. Treat as sensitive (contains hostname/pid) and do NOT expose.
  token: string | null;
}

export interface LockInfo {
  exists: boolean;
  lockId: string | null;
  ttlMs: number | null;
}

export interface LockValueMetadata {
  lockId: string;
  hostname: string;
  pid: number;
  acquiredAt: number;
}

@Injectable()
export class DistributedLockService implements OnModuleDestroy {
  private readonly logger = new Logger(DistributedLockService.name);

  // Tracks { key → token } for graceful-shutdown release. Not used on the hot
  // path of release()/extend() — those take the token directly from the caller
  // so the service itself stays effectively stateless.
  private readonly heldTokens = new Map<string, string>();

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

  constructor(@Inject(LOCK_REDIS) private readonly redis: Redis) {}

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
    const token = JSON.stringify({
      lockId,
      hostname: os.hostname(),
      pid: process.pid,
      acquiredAt: Date.now()
    } satisfies LockValueMetadata);
    const attemptsAllowed = Math.max(0, maxRetries);

    for (let attempt = 0; attempt <= attemptsAllowed; attempt++) {
      try {
        const result = await this.redis.set(key, token, 'PX', ttlMs, 'NX');

        if (result === 'OK') {
          this.heldTokens.set(key, token);
          this.logger.debug(`Lock acquired: ${key} (lockId: ${lockId.substring(0, 8)}...)`);
          return { acquired: true, lockId, token };
        }
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.error(`Failed to acquire lock ${key}: ${err.message}`);
        return { acquired: false, lockId: null, token: null };
      }

      if (attempt < attemptsAllowed) {
        await this.sleep(retryDelayMs);
      }
    }

    this.logger.debug(`Lock not acquired: ${key} (already held by another instance)`);
    return { acquired: false, lockId: null, token: null };
  }

  /**
   * Releases a distributed lock. Caller must pass the `token` returned by
   * acquire() — the Lua script only deletes the key if the stored value
   * matches, so another instance's lock cannot be clobbered.
   */
  async release(key: string, token: string | null): Promise<boolean> {
    if (!token) {
      this.logger.warn(`Cannot release lock ${key}: no token provided`);
      return false;
    }

    try {
      const result = await this.redis.eval(this.RELEASE_SCRIPT, 1, key, token);
      const released = result === 1;

      if (released) {
        this.logger.debug(`Lock released: ${key}`);
      } else {
        this.logger.warn(`Lock ${key} not released: ownership mismatch or already expired`);
      }

      if (this.heldTokens.get(key) === token) {
        this.heldTokens.delete(key);
      }

      return released;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to release lock ${key}: ${err.message}`);
      return false;
    }
  }

  /**
   * Gets information about a lock. Parses the stored JSON payload and
   * returns only the UUID so the external `lockId` contract stays stable.
   */
  async getLockInfo(key: string): Promise<LockInfo> {
    try {
      const [rawValue, ttl] = await Promise.all([this.redis.get(key), this.redis.pttl(key)]);

      if (rawValue === null) {
        return { exists: false, lockId: null, ttlMs: null };
      }

      let lockId: string | null = null;
      try {
        const parsed = JSON.parse(rawValue) as LockValueMetadata;
        lockId = typeof parsed?.lockId === 'string' ? parsed.lockId : null;
      } catch {
        lockId = rawValue;
      }

      return {
        exists: true,
        lockId,
        ttlMs: ttl > 0 ? ttl : null
      };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to get lock info for ${key}: ${err.message}`);
      return { exists: false, lockId: null, ttlMs: null };
    }
  }

  /**
   * Extends the TTL of a lock if we still own it. Caller passes the token
   * returned by acquire().
   */
  async extend(key: string, token: string, ttlMs: number): Promise<boolean> {
    try {
      const result = await this.redis.eval(this.EXTEND_SCRIPT, 1, key, token, ttlMs);
      return result === 1;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to extend lock ${key}: ${err.message}`);
      return false;
    }
  }

  /**
   * Releases every lock still held by this process on graceful shutdown.
   * Runs before SharedLockModule.onModuleDestroy() closes the Redis connection
   * because Nest destroys dependents first. Covers graceful SIGTERM (Railway
   * redeploy, ctrl-c, app.close()). SIGKILL/OOM cannot be caught — those are
   * handled by StaleLockSweepService at boot.
   */
  async onModuleDestroy(): Promise<void> {
    const held = Array.from(this.heldTokens.entries());
    if (held.length === 0) return;

    this.logger.log(`Releasing ${held.length} held lock(s) on shutdown`);
    await Promise.allSettled(held.map(([key, token]) => this.release(key, token)));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
