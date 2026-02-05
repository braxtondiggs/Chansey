import { registerAs } from '@nestjs/config';

export interface RedisConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls: boolean;
  url?: string;
}

export const redisConfig = registerAs(
  'redis',
  (): RedisConfig => ({
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    username: process.env.REDIS_USER || undefined,
    password: process.env.REDIS_PASSWORD || undefined,
    tls: process.env.REDIS_TLS === 'true',
    url: process.env.REDIS_URL
  })
);
