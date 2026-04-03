---
description: Shared resilience utilities — circuit breakers, distributed locks, retry helpers, CCXT error mapping
globs:
  - "apps/api/src/shared/**"
---

# Shared Resilience Module

## Module Structure

Two global modules:

- **`SharedResilienceModule`** — exports `CircuitBreakerService`
- **`SharedLockModule`** — exports `DistributedLockService`, `TradeCooldownService`, `LOCK_REDIS` token

Lock Redis runs on DB `1` (separate from BullMQ/cache DB), closed in `onModuleDestroy`.

## Utility Inventory (no DI — import from `'../shared'`)

| Utility | Purpose |
|---------|---------|
| `withRetry` / `withRetryThrow` | Exponential backoff + jitter. `isTransientError()` covers network/rate-limit/50x/CCXT errors |
| `withRateLimitRetry` | Preset for exchange API calls, respects `Retry-After` headers |
| `mapCcxtError()` | Maps CCXT exceptions → `AppException` subclasses |
| `precisionToStepSize()` | Handles 3 CCXT precision modes (TICK_SIZE, DECIMAL_PLACES, SIGNIFICANT_DIGITS) |
| `forceRemoveJob()` | Orphaned BullMQ job recovery after deployment |
| `toErrorInfo()` | Safe message/stack extraction from unknown errors |

### Gotcha

Binance `DDoSProtection` with "permission" in message → reclassified as `ExchangePermissionDeniedException` by `mapCcxtError()`.

## CircuitBreakerService

In-memory, keyed by string. States: CLOSED → OPEN → HALF_OPEN → CLOSED.

- **5 failures / 60s** opens the circuit
- **30s** reset timeout
- **2 successes** in HALF_OPEN to close

## TradeCooldownService

Redis-based, 11min TTL, atomic Lua check-and-claim.

**Fail-open design**: Redis down = trading allowed (never blocks trades due to infrastructure failure).

## When Adding New Utilities

- Pure functions go in utility files (no DI needed)
- Stateful services go in the appropriate global module
- Keep `isTransientError()` up to date when adding new error types
