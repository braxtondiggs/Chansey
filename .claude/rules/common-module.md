---
description: Common foundation — exception hierarchy, CLS context, global filters, metrics, crypto
globs:
  - "apps/api/src/common/**"
---

# Common Module

## Overview
37 files. Foundation shared across all API modules — exception hierarchy, CLS context, global filters, metrics calculators, and crypto utilities.

## Directory Layout
```
common/
├── exceptions/
│   ├── base/              # AppException (abstract) → 9 base exception types
│   ├── auth/              # Auth leaf exceptions
│   ├── backtest/          # Backtest leaf exceptions
│   ├── external/          # External service leaf exceptions
│   ├── order/             # Order leaf exceptions
│   ├── resource/          # Resource leaf exceptions
│   └── error-codes.enum.ts # ErrorCode enum — 58 codes in DOMAIN.SPECIFIC_ERROR format
├── filters/               # GlobalExceptionFilter
├── cls/                   # ClsContextModule, ClsContextInterceptor, RequestContext
├── metrics/               # Pure function calculators + 3 injectable services
├── crypto.service.ts      # CryptoService (AES-256-CBC, hashing)
└── index.ts
```

## Key Patterns
- **Exception hierarchy**: `AppException` (abstract) → 9 base types → leaf exceptions. Leaf pattern: extend base type, provide `ErrorCode` and `context`
- **ErrorCode enum**: 58 codes in `DOMAIN.SPECIFIC_ERROR` format (e.g., `AUTH.INVALID_TOKEN`, `ORDER.INSUFFICIENT_BALANCE`)
- **CLS context**: `ClsContextModule` (@Global) seeds `requestId`, `ipAddress`, `userAgent` per request. `ClsContextInterceptor` adds `userId` after JWT guard. Access via `RequestContext` service
- **GlobalExceptionFilter**: 5xx → error log, 4xx → warn log, attaches `requestId`/`userId`
- **Metrics**: Pure functions in `metric-calculator.ts` + 3 injectable services (Sharpe, Correlation, Drawdown). Not registered in common module — imported directly by domain modules

## How to Add a New Exception
1. Choose the appropriate base type from `exceptions/base/`
2. Create leaf class in `exceptions/<category>/`
3. Add a new `ErrorCode` entry to the enum
4. Pass `ErrorCode` and contextual data to the base constructor

## Available Utilities
- **CryptoService**: `encrypt()`, `decrypt()` (AES-256-CBC), `hash()` (SHA-256), audit chain hashing
- **RequestContext**: `getRequestId()`, `getUserId()`, `getIpAddress()`, `getUserAgent()`
- **Metric calculators**: Sharpe ratio, max drawdown, correlation — pure functions and injectable services

## Gotchas
- Metrics calculators are not centrally registered — import them directly in your domain module
- `ClsContextInterceptor` runs after the JWT guard — `userId` is only available in authenticated routes
- Always use `ErrorCode` enum values, not raw strings, when creating exceptions
- `GlobalExceptionFilter` is applied globally — don't add per-controller exception filters unless you need to override behavior
