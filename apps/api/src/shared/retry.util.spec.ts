import { type Logger } from '@nestjs/common';

import {
  exchangeAwareDelay,
  extractRetryAfterMs,
  isAuthenticationError,
  isClockSkewError,
  isRateLimitError,
  isTransientError,
  rateLimitAwareDelay,
  withExchangeRetry,
  withExchangeRetryThrow,
  withRateLimitRetry,
  withRateLimitRetryThrow,
  withRetry,
  withRetryThrow
} from './retry.util';

describe('retry.util', () => {
  describe('isTransientError', () => {
    it('should identify network errors as transient', () => {
      expect(isTransientError(new Error('ECONNRESET'))).toBe(true);
      expect(isTransientError(new Error('ECONNREFUSED'))).toBe(true);
      expect(isTransientError(new Error('ETIMEDOUT'))).toBe(true);
      expect(isTransientError(new Error('ENOTFOUND'))).toBe(true);
      expect(isTransientError(new Error('socket hang up'))).toBe(true);
      expect(isTransientError(new Error('fetch failed'))).toBe(true);
    });

    it('should identify rate limit errors as transient', () => {
      expect(isTransientError(new Error('rate limit exceeded'))).toBe(true);
      expect(isTransientError(new Error('too many requests'))).toBe(true);
      expect(isTransientError(new Error('HTTP 429'))).toBe(true);
    });

    it('should identify server errors as transient', () => {
      expect(isTransientError(new Error('503 Service Unavailable'))).toBe(true);
      expect(isTransientError(new Error('502 Bad Gateway'))).toBe(true);
      expect(isTransientError(new Error('504 Gateway Timeout'))).toBe(true);
      expect(isTransientError(new Error('temporarily unavailable'))).toBe(true);
    });

    it('should identify CCXT-specific errors as transient', () => {
      const networkError = new Error('Network error');
      networkError.name = 'NetworkError';
      expect(isTransientError(networkError)).toBe(true);

      const exchangeNotAvailable = new Error('Exchange not available');
      exchangeNotAvailable.name = 'ExchangeNotAvailable';
      expect(isTransientError(exchangeNotAvailable)).toBe(true);

      const requestTimeout = new Error('Request timed out');
      requestTimeout.name = 'RequestTimeout';
      expect(isTransientError(requestTimeout)).toBe(true);
    });

    it('should identify PostgreSQL connection errors as transient', () => {
      expect(isTransientError(new Error('Connection terminated unexpectedly'))).toBe(true);
      expect(isTransientError(new Error('server closed the connection unexpectedly'))).toBe(true);
      expect(isTransientError(new Error('connection is not open'))).toBe(true);
      expect(isTransientError(new Error('too many connections for role'))).toBe(true);
      expect(isTransientError(new Error('remaining connection slots are reserved'))).toBe(true);
      expect(isTransientError(new Error('terminating connection due to administrator command'))).toBe(true);
      expect(isTransientError(new Error('could not connect to server: Connection refused'))).toBe(true);
      expect(isTransientError(new Error('the database system is starting up'))).toBe(true);
      expect(isTransientError(new Error('the database system is shutting down'))).toBe(true);
    });

    it('should not identify business errors as transient', () => {
      expect(isTransientError(new Error('Invalid order'))).toBe(false);
      expect(isTransientError(new Error('Insufficient balance'))).toBe(false);
      expect(isTransientError(new Error('Invalid API key'))).toBe(false);
    });

    it('should not false-positive on status code substrings', () => {
      expect(isTransientError(new Error('Order #42900 not found'))).toBe(false);
      expect(isTransientError(new Error('Order #50300 processed'))).toBe(false);
      expect(isTransientError(new Error('Order #50200 processed'))).toBe(false);
      expect(isTransientError(new Error('Order #50400 processed'))).toBe(false);
    });
  });

  describe('withRetry', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should succeed on first attempt', async () => {
      const operation = jest.fn().mockResolvedValue('success');

      const result = await withRetry(operation, { maxRetries: 3 });

      expect(result.success).toBe(true);
      expect(result.result).toBe('success');
      expect(result.attempts).toBe(1);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on transient error and succeed', async () => {
      const operation = jest.fn().mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce('success');

      const promise = withRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 10,
        isRetryable: isTransientError
      });

      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.result).toBe('success');
      expect(result.attempts).toBe(2);
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should fail after max retries exceeded', async () => {
      const error = new Error('ECONNRESET');
      const operation = jest.fn().mockRejectedValue(error);

      const promise = withRetry(operation, {
        maxRetries: 2,
        initialDelayMs: 10,
        isRetryable: isTransientError
      });

      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBe(error);
      expect(result.attempts).toBe(3); // initial + 2 retries
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should not retry non-transient errors', async () => {
      const error = new Error('Invalid order');
      const operation = jest.fn().mockRejectedValue(error);

      const result = await withRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 10,
        isRetryable: isTransientError
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe(error);
      expect(result.attempts).toBe(1);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should wrap non-Error thrown values', async () => {
      const operation = jest.fn().mockRejectedValue('string error');

      const result = await withRetry(operation, { maxRetries: 0 });

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect((result.error as Error).message).toBe('string error');
    });

    it('should log retry attempts when logger provided', async () => {
      const mockLogger = { warn: jest.fn(), error: jest.fn() } as unknown as Logger;
      const operation = jest.fn().mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce('success');

      const promise = withRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 10,
        isRetryable: isTransientError,
        logger: mockLogger,
        operationName: 'testOp'
      });

      await jest.runAllTimersAsync();
      await promise;

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('testOp failed (attempt 1/4)'));
    });

    it('should log error on final failure when logger provided', async () => {
      const mockLogger = { warn: jest.fn(), error: jest.fn() } as unknown as Logger;
      const operation = jest.fn().mockRejectedValue(new Error('ECONNRESET'));

      const promise = withRetry(operation, {
        maxRetries: 1,
        initialDelayMs: 10,
        isRetryable: isTransientError,
        logger: mockLogger,
        operationName: 'testOp'
      });

      await jest.runAllTimersAsync();
      await promise;

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('testOp failed after 2 attempts'));
    });

    it('should track total delay time', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce('success');

      const promise = withRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 2,
        isRetryable: isTransientError
      });

      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.totalDelayMs).toBeGreaterThan(0);
    });
  });

  describe('withRetryThrow', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should return result on success', async () => {
      const operation = jest.fn().mockResolvedValue('success');

      const result = await withRetryThrow(operation, { maxRetries: 3 });

      expect(result).toBe('success');
    });

    it('should throw on failure after retries', async () => {
      const error = new Error('ECONNRESET');
      const operation = jest.fn().mockRejectedValue(error);

      const promise = withRetryThrow(operation, {
        maxRetries: 2,
        initialDelayMs: 10,
        isRetryable: isTransientError
      });

      const expectation = expect(promise).rejects.toThrow('ECONNRESET');
      await jest.runAllTimersAsync();
      await expectation;
    });
  });

  describe('isRateLimitError', () => {
    it.each([
      [
        'RateLimitExceeded class',
        () => {
          class RateLimitExceeded extends Error {
            constructor() {
              super('rate limit');
            }
          }
          return new RateLimitExceeded();
        }
      ],
      [
        'DDoSProtection class',
        () => {
          class DDoSProtection extends Error {
            constructor() {
              super('ddos protection');
            }
          }
          return new DDoSProtection();
        }
      ],
      [
        'error.name = RateLimitExceeded',
        () => {
          const e = new Error('some message');
          e.name = 'RateLimitExceeded';
          return e;
        }
      ],
      [
        'error.name = DDoSProtection',
        () => {
          const e = new Error('some message');
          e.name = 'DDoSProtection';
          return e;
        }
      ]
    ])('should detect %s', (_label, makeError) => {
      expect(isRateLimitError(makeError())).toBe(true);
    });

    it('should detect rate limit string patterns in message', () => {
      expect(isRateLimitError(new Error('rate limit exceeded'))).toBe(true);
      expect(isRateLimitError(new Error('too many requests'))).toBe(true);
      expect(isRateLimitError(new Error('HTTP 429 Too Many Requests'))).toBe(true);
    });

    it('should return false for non-rate-limit errors', () => {
      expect(isRateLimitError(new Error('ECONNRESET'))).toBe(false);
      expect(isRateLimitError(new Error('ETIMEDOUT'))).toBe(false);
      expect(isRateLimitError(new Error('503 Service Unavailable'))).toBe(false);
      expect(isRateLimitError(new Error('Invalid order'))).toBe(false);
    });

    it('should not false-positive on 429 as a substring', () => {
      expect(isRateLimitError(new Error('Order #42900 not found'))).toBe(false);
    });
  });

  describe('isAuthenticationError', () => {
    it.each([
      [
        'AuthenticationError class',
        () => {
          class AuthenticationError extends Error {}
          return new AuthenticationError('bad key');
        }
      ],
      [
        'PermissionDenied class',
        () => {
          class PermissionDenied extends Error {}
          return new PermissionDenied('denied');
        }
      ],
      [
        'AccountSuspended class',
        () => {
          class AccountSuspended extends Error {}
          return new AccountSuspended('suspended');
        }
      ],
      [
        'error.name = AuthenticationError',
        () => {
          const e = new Error('bad key');
          e.name = 'AuthenticationError';
          return e;
        }
      ]
    ])('should detect %s', (_label, makeError) => {
      expect(isAuthenticationError(makeError())).toBe(true);
    });

    it('should return false for non-auth errors', () => {
      expect(isAuthenticationError(new Error('rate limit exceeded'))).toBe(false);
      expect(isAuthenticationError(new Error('ECONNRESET'))).toBe(false);
    });
  });

  describe('extractRetryAfterMs', () => {
    it('should parse Retry-After header value in seconds', () => {
      expect(extractRetryAfterMs(new Error('Retry-After: 5'))).toBe(5000);
      expect(extractRetryAfterMs(new Error('retry-after: 10'))).toBe(10000);
    });

    it('should parse "retry after N seconds" pattern', () => {
      expect(extractRetryAfterMs(new Error('Please retry after 30 seconds'))).toBe(30000);
    });

    it('should return null for zero-second Retry-After', () => {
      expect(extractRetryAfterMs(new Error('Retry-After: 0'))).toBeNull();
    });

    it('should cap at maximum of 120000ms', () => {
      expect(extractRetryAfterMs(new Error('Retry-After: 300'))).toBe(120000);
    });

    it('should return null when no Retry-After hint found', () => {
      expect(extractRetryAfterMs(new Error('ECONNRESET'))).toBeNull();
      expect(extractRetryAfterMs(new Error('rate limit exceeded'))).toBeNull();
    });
  });

  describe('rateLimitAwareDelay', () => {
    it('should return Retry-After delay for rate limit errors when header present', () => {
      const error = new Error('rate limit exceeded, Retry-After: 10');
      const delay = rateLimitAwareDelay(error, 1, 5000);

      expect(delay).toBe(10000); // 10s from header > 5s default
    });

    it('should return preset delay for rate limit errors without Retry-After', () => {
      const error = new Error('rate limit exceeded');
      const delay = rateLimitAwareDelay(error, 1, 2000);

      // Should use max of RATE_LIMIT_RETRY_OPTIONS.initialDelayMs (5000) and defaultDelay (2000)
      expect(delay).toBe(5000);
    });

    it('should return undefined for non-rate-limit errors', () => {
      const error = new Error('ECONNRESET');
      const delay = rateLimitAwareDelay(error, 1, 1000);

      expect(delay).toBeUndefined();
    });
  });

  describe('onRetry callback in withRetry', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should use custom delay when onRetry returns a number', async () => {
      const onRetry = jest.fn().mockReturnValue(42);
      const operation = jest.fn().mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce('success');

      const promise = withRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 10,
        isRetryable: isTransientError,
        onRetry
      });

      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, expect.any(Number));
      expect(result.totalDelayMs).toBe(42);
    });

    it('should use default delay when onRetry returns void', async () => {
      const onRetry = jest.fn().mockReturnValue(undefined);
      const operation = jest.fn().mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce('success');

      const promise = withRetry(operation, {
        maxRetries: 3,
        initialDelayMs: 100,
        backoffMultiplier: 1,
        maxDelayMs: 1000,
        isRetryable: isTransientError,
        onRetry
      });

      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(onRetry).toHaveBeenCalled();
      expect(result.totalDelayMs).toBeGreaterThan(0);
    });
  });

  describe('withRateLimitRetry', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should retry rate limit errors with longer delays', async () => {
      const error = new Error('rate limit exceeded');
      const operation = jest.fn().mockRejectedValueOnce(error).mockResolvedValueOnce('recovered');

      const promise = withRateLimitRetry(operation);

      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.result).toBe('recovered');
      expect(result.attempts).toBe(2);
      // Rate limit delay should be at least 5000ms (the preset initialDelayMs)
      expect(result.totalDelayMs).toBeGreaterThanOrEqual(5000 * 0.75); // accounting for jitter
    });

    it('should also retry non-rate-limit transient errors', async () => {
      const operation = jest.fn().mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce('recovered');

      const promise = withRateLimitRetry(operation);

      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.result).toBe('recovered');
    });

    it('should fail after max retries', async () => {
      const error = new Error('rate limit exceeded');
      const operation = jest.fn().mockRejectedValue(error);

      const promise = withRateLimitRetry(operation);

      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBe(error);
      expect(result.attempts).toBe(4); // initial + 3 retries
    });
  });

  describe('isClockSkewError', () => {
    it('should detect Binance -1021 error code', () => {
      expect(
        isClockSkewError(
          new Error('binanceus {"code":-1021,"msg":"Timestamp for this request is outside of the recvWindow"}')
        )
      ).toBe(true);
    });

    it('should detect recvWindow in message', () => {
      expect(isClockSkewError(new Error('recvWindow exceeded'))).toBe(true);
    });

    it('should detect -1021 in message', () => {
      expect(isClockSkewError(new Error('Error -1021: Timestamp issue'))).toBe(true);
    });

    it('should return false for non-clock-skew errors', () => {
      expect(isClockSkewError(new Error('ECONNRESET'))).toBe(false);
      expect(isClockSkewError(new Error('rate limit exceeded'))).toBe(false);
      expect(isClockSkewError(new Error('Invalid API key'))).toBe(false);
    });
  });

  describe('isTransientError with clock skew', () => {
    it('should classify clock skew errors as transient', () => {
      expect(isTransientError(new Error('binanceus -1021 recvWindow exceeded'))).toBe(true);
    });
  });

  describe('exchangeAwareDelay', () => {
    it('should return 500ms for clock skew errors', () => {
      const error = new Error('recvWindow exceeded -1021');
      expect(exchangeAwareDelay(error, 1, 2000)).toBe(500);
    });

    it('should return Retry-After delay for rate limit errors', () => {
      const error = new Error('rate limit exceeded, Retry-After: 10');
      const delay = exchangeAwareDelay(error, 1, 5000);
      expect(delay).toBe(10000);
    });

    it('should return preset delay for rate limit errors without Retry-After', () => {
      const error = new Error('rate limit exceeded');
      const delay = exchangeAwareDelay(error, 1, 2000);
      expect(delay).toBe(5000);
    });

    it('should return undefined for timeout/network errors (use default backoff)', () => {
      expect(exchangeAwareDelay(new Error('ECONNRESET'), 1, 1000)).toBeUndefined();
      expect(exchangeAwareDelay(new Error('ETIMEDOUT'), 1, 1000)).toBeUndefined();
    });
  });

  describe('withExchangeRetry', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should retry clock skew errors with minimal delay', async () => {
      const error = new Error('recvWindow exceeded -1021');
      const operation = jest.fn().mockRejectedValueOnce(error).mockResolvedValueOnce('recovered');

      const promise = withExchangeRetry(operation);

      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.result).toBe('recovered');
      expect(result.totalDelayMs).toBe(500);
    });

    it('should retry transient errors with backoff', async () => {
      const operation = jest.fn().mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce('recovered');

      const promise = withExchangeRetry(operation);

      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.result).toBe('recovered');
    });
  });

  describe('withExchangeRetryThrow', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should succeed on retry after transient error', async () => {
      const operation = jest.fn().mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce('recovered');

      const promise = withExchangeRetryThrow(operation);

      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('recovered');
    });

    it('should throw on final failure', async () => {
      const error = new Error('ECONNRESET');
      const operation = jest.fn().mockRejectedValue(error);

      const promise = withExchangeRetryThrow(operation);

      const expectation = expect(promise).rejects.toThrow('ECONNRESET');
      await jest.runAllTimersAsync();
      await expectation;
    });
  });

  describe('withRateLimitRetryThrow', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should succeed on retry after rate limit', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('rate limit exceeded'))
        .mockResolvedValueOnce('recovered');

      const promise = withRateLimitRetryThrow(operation);

      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('recovered');
    });

    it('should throw on final failure', async () => {
      const error = new Error('rate limit exceeded');
      const operation = jest.fn().mockRejectedValue(error);

      const promise = withRateLimitRetryThrow(operation);

      const expectation = expect(promise).rejects.toThrow('rate limit exceeded');
      await jest.runAllTimersAsync();
      await expectation;
    });
  });
});
