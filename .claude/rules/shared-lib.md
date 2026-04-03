---
description: Shared library (@chansey/shared) — TanStack Query infrastructure, API error handling, cache policies
globs:
  - "libs/shared/**"
---

# Shared Library (`@chansey/shared`)

## API Error Handling (`api-error.ts`)

- `ApiError` class with `hasCode(code)` and `hasCodePrefix(prefix)`
- `ErrorCodes` const — all backend error codes
- `isApiError()` type guard
- `extractErrorInfo()` — normalizes unknown errors

## Cache Policies (`cache-policies.ts`)

| Policy | Stale | Refetch |
|--------|-------|---------|
| `REALTIME_POLICY` | 0 | 30s/45s |
| `FREQUENT_POLICY` | 30s | 5m |
| `STANDARD_POLICY` | 1m | 10m (default) |
| `STABLE_POLICY` | 5m | 30m |
| `STATIC_POLICY` | 10m | 1h |
| `INFINITE_POLICY` | Infinity | 24h |

`TIME` constants provide named durations.

## Query Keys (`query-keys.ts`)

Single `queryKeys` object — source of truth for all cache keys.

Pattern: `domain.all` → `domain.lists()` → `domain.list(filters?)` → `domain.detail(id)`. All `as const`.

## Query Utils (`query-utils.ts`)

### `authenticatedFetch<T>()`
- HttpOnly cookie credentials
- Transparent 401 → token refresh → single retry
- Coalesces concurrent refresh calls
- Dispatches `auth:session-expired` event on terminal failure

### `useAuthQuery<T>()`
Two overloads: static `(queryKey, url)` and reactive `(factory)`. Default: `STANDARD_POLICY`.

### `useAuthMutation<TData, TVariables>()`
- `url` can be a function
- **Auto-strips `id` from body** for PATCH/DELETE
- Handles FormData
- Runs `invalidateQueries` before `onSuccess`

### Other Utilities
`useInvalidateQueries()`, `usePrefetchQuery()`, `useSetQueryData()`, `useGetQueryData()`, `createDomainInvalidator()`, `batchInvalidate()`
