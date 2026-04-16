import { type Logger } from '@nestjs/common';

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
  /**
   * Callback invoked before each retry sleep.
   * If it returns a number, that value is used as the delay (in ms) instead of the default.
   * If it returns void/undefined, the default calculated delay is used.
   */
  onRetry?: (error: Error, attempt: number, defaultDelayMs: number) => number | void;
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
export const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, 'logger' | 'operationName' | 'onRetry'>> = {
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
    /\b429\b/.test(message) ||
    name.includes('ratelimit')
  ) {
    return true;
  }

  // Temporary server errors
  if (
    /\b503\b/.test(message) ||
    /\b502\b/.test(message) ||
    /\b504\b/.test(message) ||
    message.includes('service unavailable') ||
    message.includes('bad gateway') ||
    message.includes('gateway timeout') ||
    message.includes('temporarily unavailable')
  ) {
    return true;
  }

  // PostgreSQL connection errors
  if (
    message.includes('connection terminated') ||
    message.includes('server closed the connection unexpectedly') ||
    message.includes('connection is not open') ||
    message.includes('too many connections') ||
    message.includes('remaining connection slots are reserved') ||
    message.includes('terminating connection due to administrator command') ||
    message.includes('could not connect to server') ||
    message.includes('the database system is starting up') ||
    message.includes('the database system is shutting down') ||
    message.includes('timeout exceeded when trying to connect') ||
    (message.includes('canceling statement due to') && message.includes('timeout')) ||
    message.includes('connection timeout')
  ) {
    return true;
  }

  // Redis transient errors
  if (message.includes('redis is loading') || message.includes('loading the dataset in memory')) {
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

  // Clock skew errors (Binance -1021)
  if (isClockSkewError(error)) {
    return true;
  }

  return false;
}

/**
 * Check if an error is specifically a rate limit error (subset of transient errors).
 * Detects CCXT RateLimitExceeded/DDoSProtection and HTTP 429 patterns.
 */
export function isRateLimitError(error: Error): boolean {
  const constructorName = error.constructor?.name || '';
  const errorName = error.name || '';
  const message = error.message?.toLowerCase() || '';

  // CCXT class hierarchy: RateLimitExceeded, DDoSProtection
  if (
    constructorName === 'RateLimitExceeded' ||
    constructorName === 'DDoSProtection' ||
    errorName === 'RateLimitExceeded' ||
    errorName === 'DDoSProtection'
  ) {
    return true;
  }

  // String fallback for name (case-insensitive)
  const nameLower = (constructorName + errorName).toLowerCase();
  if (nameLower.includes('ratelimitexceeded') || nameLower.includes('ddosprotection')) {
    return true;
  }

  // String fallback for message
  if (message.includes('rate limit') || message.includes('too many requests') || /\b429\b/.test(message)) {
    return true;
  }

  return false;
}

/** Check if a CCXT error is an authentication/permission error (never retryable). */
export function isAuthenticationError(error: Error): boolean {
  const name = (error.constructor?.name || '') + (error.name || '');
  return /AuthenticationError|PermissionDenied|AccountSuspended/i.test(name);
}

/**
 * Check if an error is a clock skew / timestamp error (Binance -1021).
 * These errors occur when the client clock drifts from the exchange server clock
 * and the request falls outside the recvWindow.
 */
export function isClockSkewError(error: Error): boolean {
  const message = error.message || '';
  return message.includes('-1021') || /recvWindow/i.test(message);
}

/**
 * Extract a Retry-After hint from an error message (in milliseconds).
 * Parses numeric seconds from patterns like "Retry-After: 5" or "retry after 10 seconds".
 * Bounds result to 1000ms–120000ms.
 * Returns null if no hint is found.
 */
export function extractRetryAfterMs(error: Error): number | null {
  const message = error.message || '';

  // Match patterns: "Retry-After: 5", "retry-after 10", "retry after 30 seconds"
  const match = message.match(/retry[- ]?after[:\s]*(\d+)/i);
  if (!match) return null;

  const seconds = parseInt(match[1], 10);
  if (isNaN(seconds) || seconds <= 0) return null;

  const ms = seconds * 1000;
  // Bound to 1s–120s
  return Math.max(1000, Math.min(ms, 120000));
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
function calculateDelay(
  attempt: number,
  options: Required<Omit<RetryOptions, 'logger' | 'operationName' | 'onRetry'>>
): number {
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
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      const shouldRetry = attempt < opts.maxRetries && opts.isRetryable(lastError);

      if (shouldRetry) {
        let delay = calculateDelay(attempt, opts);

        // Allow onRetry callback to override the delay
        if (opts.onRetry) {
          const customDelay = opts.onRetry(lastError, attempt + 1, delay);
          if (typeof customDelay === 'number') {
            delay = customDelay;
          }
        }

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

/**
 * onRetry callback that uses longer delays for rate limit errors.
 * If the error is a rate limit, uses the Retry-After header hint or the preset initial delay (whichever is longer).
 * For non-rate-limit errors, returns undefined to use the default delay.
 */
export function rateLimitAwareDelay(error: Error, _attempt: number, defaultDelayMs: number): number | void {
  if (isRateLimitError(error)) {
    const retryAfter = extractRetryAfterMs(error);
    const rateLimitDelay = retryAfter ?? RATE_LIMIT_RETRY_OPTIONS.initialDelayMs ?? 5000;
    return Math.max(rateLimitDelay, defaultDelayMs);
  }
}

/**
 * Retry options tuned for exchange rate limit errors.
 * Uses 5s initial delay with 3x backoff (vs default 1s/2x).
 * Still retries all transient errors, but rate limits get longer delays via onRetry.
 */
export const RATE_LIMIT_RETRY_OPTIONS: Partial<RetryOptions> = {
  initialDelayMs: 5000,
  backoffMultiplier: 3,
  maxDelayMs: 60000,
  maxRetries: 3,
  isRetryable: isTransientError,
  onRetry: rateLimitAwareDelay
};

/**
 * Execute an async operation with rate-limit-aware retry logic.
 * Merges caller options with RATE_LIMIT_RETRY_OPTIONS presets.
 *
 * @param operation - The async operation to execute
 * @param options - Additional retry options (merged over rate limit defaults)
 * @returns RetryResult with success status, result/error, and metrics
 */
export async function withRateLimitRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  return withRetry(operation, { ...RATE_LIMIT_RETRY_OPTIONS, ...options });
}

/**
 * Execute an async operation with rate-limit-aware retry, throwing on final failure.
 * Convenience wrapper that throws instead of returning RetryResult.
 *
 * @param operation - The async operation to execute
 * @param options - Additional retry options (merged over rate limit defaults)
 * @returns The operation result
 * @throws The last error if all retries fail
 */
export async function withRateLimitRetryThrow<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  return withRetryThrow(operation, { ...RATE_LIMIT_RETRY_OPTIONS, ...options });
}

/**
 * onRetry callback that adapts delay by error type for exchange API calls.
 * - Rate limit: respects Retry-After or uses 5s minimum
 * - Clock skew: 500ms (just needs fresh timestamp)
 * - Timeout/network: uses default exponential backoff
 */
export function exchangeAwareDelay(error: Error, _attempt: number, defaultDelayMs: number): number | void {
  if (isRateLimitError(error)) {
    const retryAfter = extractRetryAfterMs(error);
    const rateLimitDelay = retryAfter ?? 5000;
    return Math.max(rateLimitDelay, defaultDelayMs);
  }

  if (isClockSkewError(error)) {
    return 500;
  }
}

/**
 * Retry options tuned for exchange API calls.
 * Uses 1s initial delay with 2x backoff, capped at 8s for standard errors.
 * Rate-limit errors may exceed this cap when respecting Retry-After headers.
 * Adapts delay by error type via exchangeAwareDelay: rate limits get longer waits,
 * clock skew gets minimal delay, timeouts use standard backoff.
 */
export const EXCHANGE_RETRY_OPTIONS: Partial<RetryOptions> = {
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 8000,
  maxRetries: 3,
  isRetryable: isTransientError,
  onRetry: exchangeAwareDelay
};

/**
 * Execute an async operation with exchange-aware retry logic.
 * Merges caller options with EXCHANGE_RETRY_OPTIONS presets.
 */
export async function withExchangeRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  return withRetry(operation, { ...EXCHANGE_RETRY_OPTIONS, ...options });
}

/**
 * Execute an async operation with exchange-aware retry, throwing on final failure.
 * Convenience wrapper that throws instead of returning RetryResult.
 */
export async function withExchangeRetryThrow<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  return withRetryThrow(operation, { ...EXCHANGE_RETRY_OPTIONS, ...options });
}
