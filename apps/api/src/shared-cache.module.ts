import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { createKeyv, Keyv } from '@keyv/redis';
import { CacheableMemory } from 'cacheable';

import { RedisConfig } from './config/redis.config';

@Module({
  imports: [
    CacheModule.registerAsync({
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const redis = configService.get<RedisConfig>('redis');
        return {
          stores: [
            new Keyv({
              store: new CacheableMemory({ ttl: '1m', lruSize: 5000 })
            }),
            createKeyv({
              url: redis.url,
              database: 2,
              username: redis.username,
              password: redis.password
            })
          ]
        };
      }
    })
  ],
  exports: [CacheModule]
})
export class SharedCacheModule {}
