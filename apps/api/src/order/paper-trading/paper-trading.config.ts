import { registerAs } from '@nestjs/config';

export interface PaperTradingConfig {
  queue: string;
  telemetryStream: string;
  telemetryStreamMaxLen: number;
  concurrency: number;
  defaultTickIntervalMs: number;
  maxConsecutiveErrors: number;
  priceCacheTtlMs: number;
  orderBookCacheTtlMs: number;
  maxAllocation: number;
  minAllocation: number;
  quoteCurrencies: string[];
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

const parseFloat = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return !Number.isNaN(parsed) && parsed >= 0 ? parsed : fallback;
};

const parseOrigins = (value: string | undefined): string[] => {
  if (!value) return [];
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

const parseQuoteCurrencies = (value: string | undefined): string[] => {
  if (!value) return ['USD', 'USDT', 'USDC'];
  return value
    .split(',')
    .map((currency) => currency.trim().toUpperCase())
    .filter(Boolean);
};

export const paperTradingConfig = registerAs(
  'paperTrading',
  (): PaperTradingConfig => ({
    queue: process.env.PAPER_TRADING_QUEUE ?? 'paper-trading',
    telemetryStream: process.env.PAPER_TRADING_TELEMETRY_STREAM ?? 'paper-trading-telemetry',
    telemetryStreamMaxLen: parseInteger(process.env.PAPER_TRADING_TELEMETRY_STREAM_MAXLEN, 100000),
    concurrency: parseInteger(process.env.PAPER_TRADING_CONCURRENCY, 4),
    defaultTickIntervalMs: parseInteger(process.env.PAPER_TRADING_TICK_INTERVAL_MS, 30000),
    maxConsecutiveErrors: parseInteger(process.env.PAPER_TRADING_MAX_CONSECUTIVE_ERRORS, 3),
    priceCacheTtlMs: parseInteger(process.env.PAPER_TRADING_PRICE_CACHE_TTL_MS, 5000),
    orderBookCacheTtlMs: parseInteger(process.env.PAPER_TRADING_ORDER_BOOK_CACHE_TTL_MS, 2000),
    maxAllocation: parseFloat(process.env.PAPER_TRADING_MAX_ALLOCATION, 0.2),
    minAllocation: parseFloat(process.env.PAPER_TRADING_MIN_ALLOCATION, 0.05),
    quoteCurrencies: parseQuoteCurrencies(process.env.PAPER_TRADING_QUOTE_CURRENCIES),
    websocket: {
      cors: {
        origins: parseOrigins(process.env.PAPER_TRADING_CORS_ORIGINS),
        credentials: process.env.PAPER_TRADING_CORS_CREDENTIALS !== 'false'
      }
    }
  })
);
