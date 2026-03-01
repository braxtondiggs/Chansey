import { Global, Inject, Logger, Module, OnModuleDestroy } from '@nestjs/common';

import Redis from 'ioredis';

import { DistributedLockService } from './distributed-lock.service';
import { toErrorInfo } from './error.util';
import { LOCK_REDIS, lockRedisProvider } from './lock-redis.provider';
import { TradeCooldownService } from './trade-cooldown.service';

@Global()
@Module({
  providers: [lockRedisProvider, DistributedLockService, TradeCooldownService],
  exports: [LOCK_REDIS, DistributedLockService, TradeCooldownService]
})
export class SharedLockModule implements OnModuleDestroy {
  private readonly logger = new Logger(SharedLockModule.name);

  constructor(@Inject(LOCK_REDIS) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
      this.logger.log('Lock Redis connection closed');
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Error closing lock Redis connection: ${err.message}`);
      this.redis.disconnect();
    }
  }
}
