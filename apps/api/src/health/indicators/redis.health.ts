import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import Redis from 'ioredis';

/**
 * Health indicator that monitors Redis performance metrics via INFO command.
 * Tracks memory usage, connected clients, and cache hit rate.
 */
@Injectable()
export class RedisHealthIndicator implements OnModuleDestroy {
  private readonly logger = new Logger(RedisHealthIndicator.name);
  private redis: Redis | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly healthIndicatorService: HealthIndicatorService
  ) {}

  onModuleDestroy() {
    this.disconnect();
  }

  private disconnect(): void {
    if (this.redis) {
      this.redis.disconnect();
      this.redis = null;
    }
  }

  private getClient(): Redis {
    if (!this.redis) {
      this.redis = new Redis({
        host: this.config.get('REDIS_HOST'),
        port: parseInt(this.config.get('REDIS_PORT') || '6379', 10),
        username: this.config.get('REDIS_USER'),
        password: this.config.get('REDIS_PASSWORD'),
        family: 0,
        tls: this.config.get('REDIS_TLS') === 'true' ? {} : undefined,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null // Don't retry in health checks
      });
    }
    return this.redis;
  }

  /**
   * Check Redis performance metrics
   * Fails if memory usage exceeds 90%
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    try {
      const client = this.getClient();
      const info = await client.info();
      const metrics = this.parseRedisInfo(info);

      const memoryUsedMB = Math.round(metrics.usedMemory / (1024 * 1024));
      const maxMemoryMB = metrics.maxMemory > 0 ? Math.round(metrics.maxMemory / (1024 * 1024)) : null;
      const memoryUsagePercent = maxMemoryMB ? Math.round((memoryUsedMB / maxMemoryMB) * 100) : null;

      const result = {
        memoryUsedMB,
        maxMemoryMB,
        memoryUsagePercent,
        connectedClients: metrics.connectedClients,
        cacheHitRate: metrics.cacheHitRate
      };

      // Fail if memory usage exceeds 90%
      if (memoryUsagePercent !== null && memoryUsagePercent > 90) {
        return indicator.down({ ...result, message: 'Memory usage exceeds 90%' });
      }

      return indicator.up(result);
    } catch (error) {
      // Reset connection on failure so next health check creates fresh connection
      this.disconnect();
      this.logger.error(`Redis health check failed: ${error.message}`);
      return indicator.down({ error: error.message });
    }
  }

  private parseRedisInfo(info: string): {
    usedMemory: number;
    maxMemory: number;
    connectedClients: number;
    cacheHitRate: number;
  } {
    const lines = info.split('\n');
    const data: Record<string, string> = {};

    for (const line of lines) {
      const [key, value] = line.split(':');
      if (key && value) {
        data[key.trim()] = value.trim();
      }
    }

    const usedMemory = parseInt(data['used_memory'] || '0', 10);
    const maxMemory = parseInt(data['maxmemory'] || '0', 10);
    const connectedClients = parseInt(data['connected_clients'] || '0', 10);

    // Calculate cache hit rate
    const keyspaceHits = parseInt(data['keyspace_hits'] || '0', 10);
    const keyspaceMisses = parseInt(data['keyspace_misses'] || '0', 10);
    const totalOperations = keyspaceHits + keyspaceMisses;
    const cacheHitRate = totalOperations > 0 ? Math.round((keyspaceHits / totalOperations) * 100) : 100;

    return { usedMemory, maxMemory, connectedClients, cacheHitRate };
  }
}
