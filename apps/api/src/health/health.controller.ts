import { Controller, Get } from '@nestjs/common';
import {
  DiskHealthIndicator,
  HealthCheck,
  HealthCheckService,
  HttpHealthIndicator,
  MemoryHealthIndicator,
  MikroOrmHealthIndicator
} from '@nestjs/terminus';

@Controller('health')
export class HealthController {
  constructor(
    private readonly disk: DiskHealthIndicator,
    private readonly health: HealthCheckService,
    private readonly http: HttpHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly mikroOrm: MikroOrmHealthIndicator
  ) { }

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.disk.checkStorage('storage', { path: '/', thresholdPercent: 0.25 }),
      () => this.http.pingCheck('coingecko', 'https://api.coingecko.com/api/v3/ping'),
      () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),
      () => this.mikroOrm.pingCheck('mikroOrm'),
    ]);
  }
}
