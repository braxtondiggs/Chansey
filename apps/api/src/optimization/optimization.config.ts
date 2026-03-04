import { registerAs } from '@nestjs/config';

export interface OptimizationAppConfig {
  concurrency: number;
}

const parseInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const optimizationConfig = registerAs(
  'optimization',
  (): OptimizationAppConfig => ({
    concurrency: parseInteger(process.env.OPTIMIZATION_CONCURRENCY, 5)
  })
);
