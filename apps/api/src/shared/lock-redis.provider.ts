import { FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import Redis from 'ioredis';

import { LOCK_REDIS_DB } from './distributed-lock.constants';

export const LOCK_REDIS = Symbol('LOCK_REDIS');

export const lockRedisProvider: FactoryProvider<Redis> = {
  provide: LOCK_REDIS,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): Redis =>
    new Redis({
      host: configService.get<string>('REDIS_HOST'),
      port: configService.get<number>('REDIS_PORT', 6379),
      db: LOCK_REDIS_DB,
      username: configService.get<string>('REDIS_USER') || undefined,
      password: configService.get<string>('REDIS_PASSWORD') || undefined,
      tls: configService.get<string>('REDIS_TLS') === 'true' ? {} : undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false
    })
};
