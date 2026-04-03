---
description: API utilities — decorators, interceptors, transformers, validators, sanitizers
globs:
  - "apps/api/src/utils/**"
---

# API Utils

## Decorators

| Decorator | Purpose |
|-----------|---------|
| `@UseCacheKey(factory)` | Dynamic cache key via `SetMetadata`. Pair with `CustomCacheInterceptor` |
| `@AuthThrottle()` | 3/s, 5/min, 20/hr |
| `@ApiThrottle()` | 5/s, 50/min, 500/hr |
| `@UploadThrottle()` | 1/s, 5/min, 10/hr |
| `@Match(property)` | class-validator field equality (e.g., password confirm) |
| `@MinStringNumber(min)` | Validates string coerces to number ≥ min |

## Interceptors

- `CustomCacheInterceptor` — extends NestJS default. Supports `@UseCacheKey` factories. Adds `X-Cache: HIT/MISS` header

## Transformers

- `ColumnNumericTransformer` — TypeORM transformer, PostgreSQL numeric string → `number` via `parseFloat`

## Validators

- `sanitizeNumericValue(value, opts)` — returns `null` for NaN/Infinity/overflow
- `sanitizeNumericValues<T>()` — applies sanitization to all numeric fields in an object

## Pure Utils

| Utility | Purpose |
|---------|---------|
| `sanitizeObject()` | Deep JSONB sanitization. Blocks prototype pollution, enforces depth (10), key count (100), string length (10000), array length (1000) |
| `escapeLikeWildcards()` | Escapes `%` and `_` for LIKE queries |
| `escapeHtml()` | HTML entity encoding |
| `stripNullProps()` | Removes null/undefined keys from objects |
| `strip-html.util.ts` | HTML tag removal |
| `file-validation.util.ts` | File upload validation |
| `isRecord()` | Type guard for `Record<string, unknown>` |
