import { ConfigService } from '@nestjs/config';
import {
  DiskHealthIndicator,
  HealthCheckService,
  MemoryHealthIndicator,
  MicroserviceHealthIndicator,
  TypeOrmHealthIndicator
} from '@nestjs/terminus';
import { Test, TestingModule } from '@nestjs/testing';

import { HealthController } from './health.controller';
import {
  BullMQHealthIndicator,
  DatabasePoolHealthIndicator,
  ExchangeHealthIndicator,
  OHLCHealthIndicator,
  RedisHealthIndicator
} from './indicators';

describe('HealthController', () => {
  let controller: HealthController;
  let config: { get: jest.Mock };
  let health: { check: jest.Mock };
  let memory: { checkHeap: jest.Mock };
  let microservice: { pingCheck: jest.Mock };
  let typeOrm: { pingCheck: jest.Mock };
  let disk: { checkStorage: jest.Mock };
  let bullmq: { isHealthy: jest.Mock };
  let databasePool: { isHealthy: jest.Mock };
  let exchange: { isHealthy: jest.Mock };
  let ohlc: { isHealthy: jest.Mock };
  let redisPerformance: { isHealthy: jest.Mock };

  beforeEach(async () => {
    config = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'REDIS_HOST':
            return 'redis.local';
          case 'REDIS_USER':
            return 'redis-user';
          case 'REDIS_PASSWORD':
            return 'redis-pass';
          case 'REDIS_PORT':
            return '6379';
          case 'REDIS_TLS':
            return 'true';
          case 'MINIO_HOST':
            return 'minio.local';
          case 'MINIO_PORT':
            return '9000';
          default:
            return undefined;
        }
      })
    };
    health = { check: jest.fn().mockResolvedValue({ status: 'ok' }) };
    memory = { checkHeap: jest.fn().mockResolvedValue({}) };
    microservice = { pingCheck: jest.fn().mockResolvedValue({}) };
    typeOrm = { pingCheck: jest.fn().mockResolvedValue({}) };
    disk = { checkStorage: jest.fn().mockResolvedValue({}) };
    bullmq = { isHealthy: jest.fn().mockResolvedValue({}) };
    databasePool = { isHealthy: jest.fn().mockResolvedValue({}) };
    exchange = { isHealthy: jest.fn().mockResolvedValue({}) };
    ohlc = { isHealthy: jest.fn().mockResolvedValue({}) };
    redisPerformance = { isHealthy: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: ConfigService, useValue: config },
        { provide: HealthCheckService, useValue: health },
        { provide: MemoryHealthIndicator, useValue: memory },
        { provide: MicroserviceHealthIndicator, useValue: microservice },
        { provide: TypeOrmHealthIndicator, useValue: typeOrm },
        { provide: DiskHealthIndicator, useValue: disk },
        { provide: BullMQHealthIndicator, useValue: bullmq },
        { provide: DatabasePoolHealthIndicator, useValue: databasePool },
        { provide: ExchangeHealthIndicator, useValue: exchange },
        { provide: OHLCHealthIndicator, useValue: ohlc },
        { provide: RedisHealthIndicator, useValue: redisPerformance }
      ]
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should compose the health checks with expected options', async () => {
    const result = await controller.check();

    expect(result).toEqual({ status: 'ok' });
    expect(health.check).toHaveBeenCalledTimes(1);

    const checks = health.check.mock.calls[0]?.[0];
    expect(Array.isArray(checks)).toBe(true);
    expect(checks).toHaveLength(10);

    await checks[0]();
    expect(typeOrm.pingCheck).toHaveBeenCalledWith('database');

    await checks[1]();
    expect(databasePool.isHealthy).toHaveBeenCalledWith('database_pool');

    await checks[2]();
    expect(microservice.pingCheck).toHaveBeenNthCalledWith(
      1,
      'redis',
      expect.objectContaining({
        transport: expect.anything(),
        options: {
          family: 0,
          host: 'redis.local',
          username: 'redis-user',
          password: 'redis-pass',
          port: 6379,
          tls: {}
        }
      })
    );

    await checks[3]();
    expect(redisPerformance.isHealthy).toHaveBeenCalledWith('redis_performance');

    await checks[4]();
    expect(microservice.pingCheck).toHaveBeenNthCalledWith(
      2,
      'minio',
      expect.objectContaining({
        transport: expect.anything(),
        timeout: 15000,
        options: {
          host: 'minio.local',
          port: 9000
        }
      })
    );

    await checks[5]();
    expect(memory.checkHeap).toHaveBeenCalledWith('memory_heap', 512 * 1024 * 1024);

    await checks[6]();
    expect(disk.checkStorage).toHaveBeenCalledWith('disk_storage', {
      path: '/',
      thresholdPercent: 0.9
    });

    await checks[7]();
    expect(bullmq.isHealthy).toHaveBeenCalledWith('queues');

    await checks[8]();
    expect(exchange.isHealthy).toHaveBeenCalledWith('exchanges');

    await checks[9]();
    expect(ohlc.isHealthy).toHaveBeenCalledWith('ohlc_data');
  });
});
