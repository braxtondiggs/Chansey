---
description: API configuration — database, Redis, env validation, logging
globs:
  - "apps/api/src/config/**"
---

# API Config Module

## Configuration Files

### `database.config.ts`
- TypeORM PostgreSQL connection
- `synchronize: true` in non-prod, `migrationsRun: true` in prod only
- Uses `pgcrypto` extension (not `uuid-ossp`)
- Pool size: `PG_POOL_MAX` env var (default 20)

### `redis.config.ts`
- Registered as `'redis'` namespace
- Exposes: host, port, username, password, tls, url

### `env.validation.ts`
- Zod schema validation
- **Fully skipped** in test env (`NODE_ENV=test` or `JEST_WORKER_ID` set)
- Calls `process.exit(1)` on validation failure

### `logger.config.ts`
- Pino via `nestjs-pino`
- Dev: `pino-pretty` | Prod: JSON + optional Loki
- **Redacts**: authorization, cookies, apiKey, apiSecret, token, privateKey
- **Ignores**: `/api/health`, `/api/metrics`, `/bull-board`
- Request ID resolution: `x-request-id` → `x-correlation-id` → W3C `traceparent` → random UUID
- Dynamic log levels: 5xx=error, 4xx=warn, 2xx=info

## Key Environment Variable

`DISABLE_BACKGROUND_TASKS=true` — skips all background job scheduling (used in dev/testing).
