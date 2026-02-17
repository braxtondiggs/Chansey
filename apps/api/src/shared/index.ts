export { LOCK_DEFAULTS, LOCK_KEYS, LOCK_REDIS_DB } from './distributed-lock.constants';
export { DistributedLockService, LockInfo, LockOptions, LockResult } from './distributed-lock.service';
export { isUniqueConstraintViolation, toErrorInfo } from './error.util';
export { SharedLockModule } from './shared-lock.module';

// Resilience patterns
export {
  CircuitBreakerOptions,
  CircuitBreakerService,
  CircuitOpenError,
  CircuitState,
  CircuitStats,
  DEFAULT_CIRCUIT_BREAKER_OPTIONS
} from './circuit-breaker.service';
export {
  DEFAULT_RETRY_OPTIONS,
  isTransientError,
  RetryOptions,
  RetryResult,
  withRetry,
  withRetryThrow
} from './retry.util';
export { SharedResilienceModule } from './shared-resilience.module';
