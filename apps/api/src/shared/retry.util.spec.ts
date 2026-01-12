import { Logger } from '@nestjs/common';

import { isTransientError, withRetry, withRetryThrow } from './retry.util';

describe('retry.util', () => {
  describe('isTransientError', () => {
    it('should identify network errors as transient', () => {
      expect(isTransientError(new Error('ECONNRESET'))).toBe(true);
      expect(isTransientError(new Error('ECONNREFUSED'))).toBe(true);
      expect(isTransientError(new Error('ETIMEDOUT'))).toBe(true);
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
    });

    it('should identify CCXT-specific errors as transient', () => {
      const networkError = new Error('Network error');
      networkError.name = 'NetworkError';
      expect(isTransientError(networkError)).toBe(true);

      const exchangeNotAvailable = new Error('Exchange not available');
      exchangeNotAvailable.name = 'ExchangeNotAvailable';
      expect(isTransientError(exchangeNotAvailable)).toBe(true);
    });

    it('should not identify business errors as transient', () => {
      expect(isTransientError(new Error('Invalid order'))).toBe(false);
      expect(isTransientError(new Error('Insufficient balance'))).toBe(false);
      expect(isTransientError(new Error('Invalid API key'))).toBe(false);
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
});
