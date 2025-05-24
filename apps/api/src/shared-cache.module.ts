import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';

import { createKeyv, Keyv } from '@keyv/redis';
import { CacheableMemory } from 'cacheable';

@Module({
  imports: [
    CacheModule.registerAsync({
      useFactory: async () => {
        return {
          stores: [
            new Keyv({
              store: new CacheableMemory({ ttl: '1m', lruSize: 5000 })
            }),
            createKeyv({
              url: process.env.REDIS_URL,
              database: 2,
              username: process.env.REDIS_USER,
              password: process.env.REDIS_PASSWORD
            })
          ]
        };
      }
    })
  ],
  exports: [CacheModule]
})
export class SharedCacheModule {}
