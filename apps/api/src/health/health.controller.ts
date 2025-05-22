import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisOptions, TcpClientOptions, Transport } from '@nestjs/microservices';
import { ApiExcludeController } from '@nestjs/swagger';
import {
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
    private readonly typeOrm: TypeOrmHealthIndicator
  ) {}

  @Get()
  @HealthCheck()
  async check() {
    return this.health.check([
      () => this.http.pingCheck('coingecko', 'https://api.coingecko.com/api/v3/ping'),
      () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),
      () => this.typeOrm.pingCheck('database'),
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
      () =>
        this.microservice.pingCheck<TcpClientOptions>('minio', {
          transport: Transport.TCP,
          options: {
            host: this.config.get('MINIO_HOST'),
            port: parseInt(this.config.get('MINIO_PORT'))
          }
        })
    ]);
  }
}
