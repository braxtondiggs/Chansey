import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import Redis from 'ioredis';

import { LOCK_KEYS } from './distributed-lock.constants';
import { LockValueMetadata } from './distributed-lock.service';
import { toErrorInfo } from './error.util';
import { LOCK_REDIS } from './lock-redis.provider';

/**
 * On boot, sweeps orphaned distributed-lock keys. This is a new feature —
 * there is no multi-instance deployment and no legacy value format to
 * preserve, so any lock still present at boot is by definition orphaned from
 * a previous (crashed) process and is deleted unconditionally.
 */
@Injectable()
export class StaleLockSweepService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StaleLockSweepService.name);

  constructor(@Inject(LOCK_REDIS) private readonly redis: Redis) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const key of Object.values(LOCK_KEYS)) {
      try {
        const value = await this.redis.get(key);
        if (value === null) continue;

        const deleted = await this.redis.del(key);
        if (deleted === 0) continue;

        let meta: Partial<LockValueMetadata> | null = null;
        try {
          meta = JSON.parse(value) as LockValueMetadata;
        } catch {
          // Unparseable — still swept, just log without metadata.
        }

        if (meta && typeof meta.acquiredAt === 'number') {
          this.logger.warn(
            `Swept stale lock ${key} from previous crashed instance (host=${meta.hostname ?? 'unknown'}, pid=${
              meta.pid ?? 'unknown'
            }, acquiredAt=${new Date(meta.acquiredAt).toISOString()})`
          );
        } else {
          this.logger.warn(`Swept stale lock ${key} with unparseable value`);
        }
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.error(`Failed to sweep stale lock ${key}: ${err.message}`);
      }
    }
  }
}
