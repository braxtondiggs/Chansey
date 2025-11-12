import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisOptions, TcpClientOptions, Transport } from '@nestjs/microservices';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  DiskHealthIndicator,
  HealthCheck,
  HealthCheckService,
  HttpHealthIndicator,
  MemoryHealthIndicator,
  MicroserviceHealthIndicator,
  TypeOrmHealthIndicator
} from '@nestjs/terminus';

@ApiExcludeController()
@Controller('health')
export class HealthController {
  constructor(
    private readonly config: ConfigService,
    private readonly health: HealthCheckService,
    private readonly http: HttpHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly microservice: MicroserviceHealthIndicator,
    private readonly typeOrm: TypeOrmHealthIndicator,
    private readonly disk: DiskHealthIndicator
  ) {}

  @Get()
  @HealthCheck()
  async check() {
    return this.health.check([
      // Database connectivity
      () => this.typeOrm.pingCheck('database'),

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

      // Memory usage check (fails if heap > 150MB)
      () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),

      // Disk space check (fails if > 90% full)
      () =>
        this.disk.checkStorage('disk_storage', {
          path: '/',
          thresholdPercent: 0.9
        }),

      // External API check (CoinGecko)
      () => this.http.pingCheck('coingecko', 'https://api.coingecko.com/api/v3/ping')
    ]);
  }
}
