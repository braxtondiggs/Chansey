import { Inject, Injectable, Logger } from '@nestjs/common';

import Redis from 'ioredis';

import { toErrorInfo } from './error.util';
import { LOCK_REDIS } from './lock-redis.provider';

export interface CooldownClaim {
  pipeline: string;
  claimedAt: number;
}

export interface CooldownCheckResult {
  allowed: boolean;
  existingClaim?: CooldownClaim;
}

/**
 * Cooldown TTL: 11 minutes.
 * Pipeline 1 runs every 2 min, Pipeline 2 every 5 min.
 * 11 min = 2 full Pipeline 2 cycles (5+5) + 1 min safety margin.
 */
const COOLDOWN_TTL_MS = 11 * 60 * 1000;

/**
 * TradeCooldownService
 *
 * Redis-based per-(userId, symbol, direction) trade cooldown.
 * Uses an atomic Lua check-and-set script to prevent two pipelines
 * from placing the same trade within a short window.
 *
 * Fail-open: if Redis is unreachable the trade is allowed through,
 * because blocking all trading due to a safety-check outage is worse
 * than a rare duplicate in an edge case.
 */
@Injectable()
export class TradeCooldownService {
  private readonly logger = new Logger(TradeCooldownService.name);

  /**
   * Lua script: atomically check if key exists, if not set it with value and TTL.
   * Returns 1 if claimed (key was set), or 0 + existing value if already held.
   *
   * KEYS[1] = cooldown key
   * ARGV[1] = JSON claim value
   * ARGV[2] = TTL in milliseconds
   *
   * Returns: [1] on success, [0, existingValue] if already claimed.
   */
  private readonly CHECK_AND_CLAIM_SCRIPT = `
    local existing = redis.call("GET", KEYS[1])
    if existing then
      return {0, existing}
    end
    redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2])
    return {1}
  `;

  constructor(@Inject(LOCK_REDIS) private readonly redis: Redis) {}

  /**
   * Atomically check whether a trade cooldown exists and claim it if not.
   *
   * @param userId   - User placing the trade
   * @param symbol   - Trading pair (e.g. "BTC/USDT")
   * @param direction - "BUY" or "SELL" (opposite directions are independent)
   * @param pipeline - Identifier for the claiming pipeline (for debugging)
   * @returns `{ allowed: true }` when the caller may proceed,
   *          `{ allowed: false, existingClaim }` when another pipeline already claimed this trade
   */
  async checkAndClaim(
    userId: string,
    symbol: string,
    direction: string,
    pipeline: string
  ): Promise<CooldownCheckResult> {
    const key = this.buildKey(userId, symbol, direction);
    const claim: CooldownClaim = { pipeline, claimedAt: Date.now() };

    try {
      const result = (await this.redis.eval(
        this.CHECK_AND_CLAIM_SCRIPT,
        1,
        key,
        JSON.stringify(claim),
        COOLDOWN_TTL_MS
      )) as [number, string?];

      if (result[0] === 1) {
        return { allowed: true };
      }

      const existingClaim: CooldownClaim = result[1] ? JSON.parse(result[1]) : { pipeline: 'unknown', claimedAt: 0 };
      return { allowed: false, existingClaim };
    } catch (error: unknown) {
      // Fail-open: allow trade through if Redis is unreachable
      const err = toErrorInfo(error);
      this.logger.warn(`Trade cooldown check failed (fail-open, allowing trade): ${err.message}`);
      return { allowed: true };
    }
  }

  /**
   * Clear a cooldown key so the next cycle can retry.
   * Called when a trade execution fails.
   */
  async clearCooldown(userId: string, symbol: string, direction: string): Promise<void> {
    const key = this.buildKey(userId, symbol, direction);
    try {
      await this.redis.del(key);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to clear trade cooldown ${key}: ${err.message}`);
    }
  }

  private buildKey(userId: string, symbol: string, direction: string): string {
    return `trade-cd:${userId}:${symbol}:${direction}`;
  }
}
