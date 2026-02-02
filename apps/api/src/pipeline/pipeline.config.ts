import { registerAs } from '@nestjs/config';

export interface PipelineConfig {
  queue: string;
  telemetryStream: string;
  telemetryStreamMaxLen: number;
  concurrency: number;
  timeoutMs: number;
  defaultProgressionRules: {
    optimization: { minImprovement: number };
    historical: { minSharpeRatio: number; maxDrawdown: number; minWinRate: number };
    liveReplay: { minSharpeRatio: number; maxDrawdown: number; maxDegradation: number };
    paperTrading: { minSharpeRatio: number; maxDrawdown: number; minTotalReturn: number };
  };
  websocket: {
    cors: {
      origins: string[];
      credentials: boolean;
    };
  };
}

const parseInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parseOrigins = (value: string | undefined): string[] => {
  if (!value) return [];
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

export const pipelineConfig = registerAs(
  'pipeline',
  (): PipelineConfig => ({
    queue: process.env.PIPELINE_QUEUE ?? 'pipeline',
    telemetryStream: process.env.PIPELINE_TELEMETRY_STREAM ?? 'pipeline:telemetry',
    telemetryStreamMaxLen: parseInteger(process.env.PIPELINE_TELEMETRY_STREAM_MAXLEN, 50000),
    concurrency: parseInteger(process.env.PIPELINE_CONCURRENCY, 2),
    timeoutMs: parseInteger(process.env.PIPELINE_TIMEOUT_MS, 3600000), // 1 hour default
    defaultProgressionRules: {
      optimization: {
        minImprovement: 5 // 5% improvement over baseline
      },
      historical: {
        minSharpeRatio: 1.0,
        maxDrawdown: 0.25,
        minWinRate: 0.45
      },
      liveReplay: {
        minSharpeRatio: 0.8,
        maxDrawdown: 0.3,
        maxDegradation: 20 // 20% allowed degradation from historical
      },
      paperTrading: {
        minSharpeRatio: 0.7,
        maxDrawdown: 0.35,
        minTotalReturn: 0 // At least break even
      }
    },
    websocket: {
      cors: {
        origins: parseOrigins(process.env.PIPELINE_CORS_ORIGINS),
        credentials: process.env.PIPELINE_CORS_CREDENTIALS !== 'false'
      }
    }
  })
);
