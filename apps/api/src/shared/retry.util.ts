import { Logger } from '@nestjs/common';

/**
 * Options for retry behavior
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds before first retry (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds between retries (default: 30000) */
  maxDelayMs?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Function to determine if an error is retryable (default: checks for transient errors) */
  isRetryable?: (error: Error) => boolean;
  /** Optional logger for retry attempts */
  logger?: Logger;
  /** Operation name for logging */
  operationName?: string;
}

/**
 * Result of a retry operation
 */
export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalDelayMs: number;
}

/**
 * Default retry options
 */
export const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, 'logger' | 'operationName'>> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  isRetryable: isTransientError
};

/**
 * Check if an error is a transient/retryable error
 * Covers network issues, rate limits, and temporary exchange errors
 */
export function isTransientError(error: Error): boolean {
  const message = error.message?.toLowerCase() || '';
  const name = error.name?.toLowerCase() || '';

  // Network errors
  if (
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('etimedout') ||
    message.includes('enotfound') ||
    message.includes('network') ||
    message.includes('socket hang up') ||
    message.includes('fetch failed')
  ) {
    return true;
  }

  // Rate limiting
  if (
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('429') ||
    name.includes('ratelimit')
  ) {
    return true;
  }

  // Temporary server errors
  if (
    message.includes('503') ||
    message.includes('502') ||
    message.includes('504') ||
    message.includes('service unavailable') ||
    message.includes('bad gateway') ||
    message.includes('gateway timeout') ||
    message.includes('temporarily unavailable')
  ) {
    return true;
  }

  // CCXT-specific transient errors
  if (
    name.includes('networkerror') ||
    name.includes('exchangenotavailable') ||
    name.includes('requesttimeout') ||
    name.includes('ddosprotection')
  ) {
    return true;
  }

  return false;
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(attempt: number, options: Required<Omit<RetryOptions, 'logger' | 'operationName'>>): number {
  const exponentialDelay = options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt);
  const cappedDelay = Math.min(exponentialDelay, options.maxDelayMs);
  // Add jitter (±25%) to prevent thundering herd
  const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1);
  return Math.round(cappedDelay + jitter);
}

/**
 * Execute an async operation with retry logic and exponential backoff
 *
 * @param operation - The async operation to execute
 * @param options - Retry configuration options
 * @returns RetryResult with success status, result/error, and metrics
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => exchangeClient.createOrder(symbol, 'limit', 'buy', quantity, price),
 *   {
 *     maxRetries: 3,
 *     operationName: 'createOrder',
 *     logger: this.logger
 *   }
 * );
 *
 * if (result.success) {
 *   return result.result;
 * } else {
 *   throw result.error;
 * }
 * ```
 */
export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<RetryResult<T>> {
  const opts = {
    ...DEFAULT_RETRY_OPTIONS,
    ...options
  };

  let lastError: Error | undefined;
  let attempts = 0;
  let totalDelayMs = 0;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    attempts = attempt + 1;

    try {
      const result = await operation();
      return {
        success: true,
        result,
        attempts,
        totalDelayMs
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      const shouldRetry = attempt < opts.maxRetries && opts.isRetryable(lastError);

      if (shouldRetry) {
        const delay = calculateDelay(attempt, opts);
        totalDelayMs += delay;

        if (opts.logger) {
          opts.logger.warn(
            `${opts.operationName || 'Operation'} failed (attempt ${attempt + 1}/${opts.maxRetries + 1}), ` +
              `retrying in ${delay}ms: ${lastError.message}`
          );
        }

        await sleep(delay);
      } else {
        // Not retryable or max retries exceeded
        if (opts.logger && attempt > 0) {
          opts.logger.error(
            `${opts.operationName || 'Operation'} failed after ${attempts} attempts: ${lastError.message}`
          );
        }
        break;
      }
    }
  }

  return {
    success: false,
    error: lastError,
    attempts,
    totalDelayMs
  };
}

/**
 * Execute an async operation with retry, throwing on final failure
 * Convenience wrapper around withRetry that throws instead of returning RetryResult
 *
 * @param operation - The async operation to execute
 * @param options - Retry configuration options
 * @returns The operation result
 * @throws The last error if all retries fail
 */
export async function withRetryThrow<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const result = await withRetry(operation, options);

  if (result.success) {
    return result.result as T;
  }

  throw result.error;
}
