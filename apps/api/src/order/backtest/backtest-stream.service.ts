import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';

import Redis from 'ioredis';

import { backtestConfig } from './backtest.config';
import { BacktestGateway } from './backtest.gateway';

export type TelemetryScope = 'log' | 'metric' | 'trace' | 'status';

export interface BacktestTelemetryPayload {
  runId: string;
  scope: TelemetryScope;
  level?: 'debug' | 'info' | 'warn' | 'error';
  message?: string;
  metric?: {
    name: string;
    value: number;
    unit?: string;
    tags?: Record<string, string | number>;
  };
  trace?: {
    span: string;
    durationMs?: number;
    attributes?: Record<string, unknown>;
  };
  status?: {
    state: string;
    reason?: string;
  };
  context?: Record<string, unknown>;
  timestamp?: string;
}

@Injectable()
export class BacktestStreamService implements OnModuleDestroy {
  private readonly logger = new Logger(BacktestStreamService.name);
  private readonly streamKey: string;
  private readonly redis: Redis;

  constructor(
    @Inject(backtestConfig.KEY) config: ConfigType<typeof backtestConfig>,
    private readonly gateway?: BacktestGateway
  ) {
    this.streamKey = config.telemetryStream;
    this.redis = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      username: process.env.REDIS_USER || undefined,
      password: process.env.REDIS_PASSWORD || undefined,
      tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
      maxRetriesPerRequest: null
    });
  }

  async publish(payload: BacktestTelemetryPayload): Promise<void> {
    const enriched = {
      ...payload,
      timestamp: payload.timestamp ?? new Date().toISOString()
    };

    try {
      await this.redis.xadd(this.streamKey, '*', 'payload', JSON.stringify(enriched));
    } catch (error) {
      this.logger.error(`Failed to publish telemetry for run ${payload.runId}: ${error?.message ?? error}`);
    }

    try {
      this.gateway?.emit(payload.runId, payload.scope, enriched);
    } catch (error) {
      this.logger.warn(`Failed to broadcast telemetry for run ${payload.runId}: ${error?.message ?? error}`);
    }
  }

  async publishLog(
    runId: string,
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    context?: Record<string, unknown>
  ): Promise<void> {
    await this.publish({ runId, scope: 'log', level, message, context });
  }

  async publishMetric(
    runId: string,
    name: string,
    value: number,
    unit?: string,
    tags?: Record<string, string | number>
  ): Promise<void> {
    await this.publish({ runId, scope: 'metric', metric: { name, value, unit, tags } });
  }

  async publishTrace(
    runId: string,
    span: string,
    durationMs?: number,
    attributes?: Record<string, unknown>
  ): Promise<void> {
    await this.publish({ runId, scope: 'trace', trace: { span, durationMs, attributes } });
  }

  async publishStatus(runId: string, state: string, reason?: string, context?: Record<string, unknown>): Promise<void> {
    await this.publish({ runId, scope: 'status', status: { state, reason }, context });
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch (error) {
      this.logger.warn(`Error shutting down telemetry redis connection: ${error?.message ?? error}`);
      this.redis.disconnect();
    }
  }
}
