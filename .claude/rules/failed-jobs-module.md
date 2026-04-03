---
description: Failed jobs — BullMQ failure tracking, severity classification, alerting
globs:
  - "apps/api/src/failed-jobs/**"
---

# Failed Jobs Module

## Severity Classification

| Severity | Queues |
|----------|--------|
| CRITICAL | `trade-execution`, `order-queue`, `live-trading-cron` |
| HIGH | `position-monitor`, `liquidation-monitor` |
| MEDIUM | `backtest*`, `pipeline*`, `optimization*` |
| LOW | Everything else |

## Non-Retryable Queues

`NON_RETRYABLE_QUEUES = {'live-trading-cron'}` — cron-driven queues can't be manually retried.

## Key Behaviors

- `recordFailure()` is **fail-safe** (never throws)
- Strips sensitive keys (`apiKey`, `apiSecret`, `token`) → `[REDACTED]`
- `retryJob()` resolves queue dynamically via `ModuleRef.get(getQueueToken(queueName))`

## Alert Service

- In-memory rolling window: 5 min / 5 CRITICAL failures → spike detection
- Spikes logged as `FAILED_JOB_SPIKE_DETECTED` in audit log

## Status Flow

`pending → reviewed | retried | dismissed`

- `bulkDismiss()` only updates jobs with `pending` status

## Database Indexes

- `(queueName, createdAt)`
- `(status, createdAt)`
- `(severity, createdAt)`
- `(userId, createdAt)`
