import { registerAs } from '@nestjs/config';

export interface BacktestConfig {
  historicalQueue: string;
  replayQueue: string;
  telemetryStream: string;
  historicalConcurrency: number;
  replayConcurrency: number;
}

const parseInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const backtestConfig = registerAs(
  'backtest',
  (): BacktestConfig => ({
    historicalQueue: process.env.BACKTEST_HISTORICAL_QUEUE ?? 'backtest-historical',
    replayQueue: process.env.BACKTEST_REPLAY_QUEUE ?? 'backtest-replay',
    telemetryStream: process.env.BACKTEST_TELEMETRY_STREAM ?? 'backtest-telemetry',
    historicalConcurrency: parseInteger(process.env.BACKTEST_HISTORICAL_CONCURRENCY, 4),
    replayConcurrency: parseInteger(process.env.BACKTEST_REPLAY_CONCURRENCY, 2)
  })
);
