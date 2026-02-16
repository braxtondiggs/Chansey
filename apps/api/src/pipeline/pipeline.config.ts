import { registerAs } from '@nestjs/config';

import { DEFAULT_PROGRESSION_RULES, PipelineProgressionRules } from './interfaces/pipeline-config.interface';

export interface PipelineConfig {
  queue: string;
  telemetryStream: string;
  telemetryStreamMaxLen: number;
  concurrency: number;
  timeoutMs: number;
  defaultProgressionRules: PipelineProgressionRules;
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
    defaultProgressionRules: DEFAULT_PROGRESSION_RULES,
    websocket: {
      cors: {
        origins: parseOrigins(process.env.PIPELINE_CORS_ORIGINS),
        credentials: process.env.PIPELINE_CORS_CREDENTIALS !== 'false'
      }
    }
  })
);
