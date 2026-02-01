import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisOptions, TcpClientOptions, Transport } from '@nestjs/microservices';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  DiskHealthIndicator,
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
  MicroserviceHealthIndicator,
  TypeOrmHealthIndicator
} from '@nestjs/terminus';

import {
  BullMQHealthIndicator,
  DatabasePoolHealthIndicator,
  ExchangeHealthIndicator,
  OHLCHealthIndicator,
  RedisHealthIndicator
} from './indicators';

@ApiExcludeController()
@Controller('health')
export class HealthController {
  constructor(
    private readonly config: ConfigService,
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
    private readonly microservice: MicroserviceHealthIndicator,
    private readonly typeOrm: TypeOrmHealthIndicator,
    private readonly disk: DiskHealthIndicator,
    private readonly bullmq: BullMQHealthIndicator,
    private readonly databasePool: DatabasePoolHealthIndicator,
    private readonly exchange: ExchangeHealthIndicator,
    private readonly ohlc: OHLCHealthIndicator,
    private readonly redisPerformance: RedisHealthIndicator
  ) {}

  @Get()
  @HealthCheck()
  async check() {
    return this.health.check([
      // Database connectivity
      () => this.typeOrm.pingCheck('database'),

      // Database connection pool health
      () => this.databasePool.isHealthy('database_pool'),

      // Redis connectivity
      () =>
        this.microservice.pingCheck<RedisOptions & { options: { family?: number } }>('redis', {
          transport: Transport.REDIS,
          options: {
            family: 0,
            host: this.config.get('REDIS_HOST'),
            username: this.config.get('REDIS_USER'),
            password: this.config.get('REDIS_PASSWORD'),
            port: parseInt(this.config.get('REDIS_PORT')),
            tls: this.config.get('REDIS_TLS') === 'true' ? {} : undefined
          }
        }),

      // Redis performance metrics
      () => this.redisPerformance.isHealthy('redis_performance'),

      // MinIO storage connectivity
      () =>
        this.microservice.pingCheck<TcpClientOptions>('minio', {
          transport: Transport.TCP,
          timeout: 15000,
          options: {
            host: this.config.get('MINIO_HOST'),
            port: parseInt(this.config.get('MINIO_PORT'))
          }
        }),

      // Memory usage check (fails if heap > 512MB)
      () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024),

      // Disk space check (fails if > 90% full)
      () =>
        this.disk.checkStorage('disk_storage', {
          path: '/',
          thresholdPercent: 0.9
        }),

      // BullMQ queue health
      () => this.bullmq.isHealthy('queues'),

      // Exchange connectivity and latency
      () => this.exchange.isHealthy('exchanges'),

      // OHLC data freshness
      () => this.ohlc.isHealthy('ohlc_data')
    ]);
  }
}
