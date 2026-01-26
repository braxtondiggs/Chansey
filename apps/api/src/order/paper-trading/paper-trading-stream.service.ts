import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';

import { Cache } from 'cache-manager';
import { Cluster, Redis } from 'ioredis';

import { paperTradingConfig } from './paper-trading.config';
import { PaperTradingGateway } from './paper-trading.gateway';

export type TelemetryScope = 'log' | 'metric' | 'trace' | 'status' | 'tick' | 'order' | 'balance';

export interface PaperTradingTelemetryPayload {
  sessionId: string;
  scope: TelemetryScope;
  level?: 'debug' | 'info' | 'warn' | 'error';
  message?: string;
  metric?: {
    name: string;
    value: number;
    unit?: string;
    tags?: Record<string, string | number>;
  };
  tick?: {
    portfolioValue: number;
    prices: Record<string, number>;
    tickCount: number;
    signalsReceived: number;
    ordersExecuted: number;
  };
  order?: {
    id: string;
    side: string;
    symbol: string;
    quantity: number;
    price: number;
    status: string;
  };
  balance?: {
    currency: string;
    available: number;
    locked: number;
  };
  status?: {
    state: string;
    reason?: string;
  };
  context?: Record<string, unknown>;
  timestamp?: string;
}

@Injectable()
export class PaperTradingStreamService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaperTradingStreamService.name);
  private readonly streamKey: string;
  private readonly streamMaxLen: number;
  private redis: Redis | Cluster | null = null;
  private isConnected = false;

  constructor(
    @Inject(paperTradingConfig.KEY) config: ConfigType<typeof paperTradingConfig>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly gateway?: PaperTradingGateway
  ) {
    this.streamKey = config.telemetryStream;
    this.streamMaxLen = config.telemetryStreamMaxLen;
  }

  async onModuleInit(): Promise<void> {
    await this.initializeRedis();
  }

  private async initializeRedis(): Promise<void> {
    try {
      // Try to get the Redis client from cache manager first (shared connection)
      const cacheStore = (this.cacheManager as any).store;
      if (cacheStore?.client) {
        // Use the shared Redis client from cache manager if available
        this.redis = cacheStore.client;
        this.isConnected = true;
        this.logger.log('Using shared Redis connection from cache manager');
        return;
      }

      // Fall back to creating own connection if cache manager doesn't expose client
      this.redis = new Redis({
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
        username: process.env.REDIS_USER || undefined,
        password: process.env.REDIS_PASSWORD || undefined,
        tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
        maxRetriesPerRequest: null,
        retryStrategy: (times) => {
          if (times > 10) {
            this.logger.error('Max Redis reconnection attempts reached');
            return null; // Stop retrying
          }
          return Math.min(Math.exp(times), 3000);
        },
        lazyConnect: true
      });

      this.redis.on('connect', () => {
        this.isConnected = true;
        this.logger.log('Redis connection established for telemetry stream');
      });

      this.redis.on('error', (error) => {
        this.isConnected = false;
        this.logger.warn(`Redis connection error: ${error.message}`);
      });

      this.redis.on('close', () => {
        this.isConnected = false;
        this.logger.debug('Redis connection closed');
      });

      await this.redis.connect();
    } catch (error) {
      this.logger.error(`Failed to initialize Redis connection: ${error.message}`);
      this.isConnected = false;
    }
  }

  async publish(payload: PaperTradingTelemetryPayload): Promise<void> {
    const enriched = {
      ...payload,
      timestamp: payload.timestamp ?? new Date().toISOString()
    };

    // Publish to Redis stream if connected (with MAXLEN to prevent unbounded growth)
    if (this.redis && this.isConnected) {
      try {
        // Use approximate trimming (~) for better performance
        // This keeps approximately streamMaxLen entries, allowing some variance for efficiency
        await this.redis.xadd(
          this.streamKey,
          'MAXLEN',
          '~',
          String(this.streamMaxLen),
          '*',
          'payload',
          JSON.stringify(enriched)
        );
      } catch (error) {
        this.logger.error(`Failed to publish telemetry for session ${payload.sessionId}: ${error?.message ?? error}`);
      }
    }

    // Always try to broadcast via WebSocket gateway
    try {
      this.gateway?.emit(payload.sessionId, payload.scope, enriched);
    } catch (error) {
      this.logger.warn(`Failed to broadcast telemetry for session ${payload.sessionId}: ${error?.message ?? error}`);
    }
  }

  async publishLog(
    sessionId: string,
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    context?: Record<string, unknown>
  ): Promise<void> {
    await this.publish({ sessionId, scope: 'log', level, message, context });
  }

  async publishMetric(
    sessionId: string,
    name: string,
    value: number,
    unit?: string,
    tags?: Record<string, string | number>
  ): Promise<void> {
    await this.publish({ sessionId, scope: 'metric', metric: { name, value, unit, tags } });
  }

  async publishTick(
    sessionId: string,
    tick: {
      portfolioValue: number;
      prices: Record<string, number>;
      tickCount: number;
      signalsReceived: number;
      ordersExecuted: number;
    }
  ): Promise<void> {
    await this.publish({ sessionId, scope: 'tick', tick });
  }

  async publishOrder(
    sessionId: string,
    order: {
      id: string;
      side: string;
      symbol: string;
      quantity: number;
      price: number;
      status: string;
    }
  ): Promise<void> {
    await this.publish({ sessionId, scope: 'order', order });
  }

  async publishBalance(
    sessionId: string,
    balance: {
      currency: string;
      available: number;
      locked: number;
    }
  ): Promise<void> {
    await this.publish({ sessionId, scope: 'balance', balance });
  }

  async publishStatus(
    sessionId: string,
    state: string,
    reason?: string,
    context?: Record<string, unknown>
  ): Promise<void> {
    await this.publish({ sessionId, scope: 'status', status: { state, reason }, context });
  }

  async onModuleDestroy(): Promise<void> {
    // Only disconnect if we created our own connection (not shared from cache manager)
    const cacheStore = (this.cacheManager as any).store;
    if (this.redis && !cacheStore?.client) {
      try {
        await this.redis.quit();
      } catch (error) {
        this.logger.warn(`Error shutting down telemetry redis connection: ${error?.message ?? error}`);
        this.redis.disconnect();
      }
    }
    this.redis = null;
    this.isConnected = false;
  }
}
