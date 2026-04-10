import { type FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import Redis from 'ioredis';

export const NOTIFICATION_REDIS_DB = 5;
export const NOTIFICATION_REDIS = Symbol('NOTIFICATION_REDIS');

export const notificationRedisProvider: FactoryProvider<Redis> = {
  provide: NOTIFICATION_REDIS,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): Redis =>
    new Redis({
      host: configService.get<string>('REDIS_HOST'),
      port: configService.get<number>('REDIS_PORT', 6379),
      db: NOTIFICATION_REDIS_DB,
      username: configService.get<string>('REDIS_USER') || undefined,
      password: configService.get<string>('REDIS_PASSWORD') || undefined,
      tls: configService.get<string>('REDIS_TLS') === 'true' ? {} : undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false
    })
};
