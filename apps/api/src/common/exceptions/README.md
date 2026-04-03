# Exceptions

## Overview

Structured exception hierarchy for the API. All application errors extend the abstract `AppException` base class, which provides a consistent response shape with machine-readable `ErrorCode`, human-readable message, optional context, and timestamp. The `GlobalExceptionFilter` handles serialization to HTTP responses automatically.

## Hierarchy

`AppException` (abstract) -> 9 base types -> 37 leaf exceptions across 5 domain categories.

## Base Types

| Base Type                 | HTTP Status | When to Use                                  |
| ------------------------- | ----------- | -------------------------------------------- |
| `AuthenticationException` | 401         | Invalid credentials, expired/invalid tokens  |
| `ValidationException`     | 400         | Malformed input, missing fields, bad format  |
| `NotFoundException`       | 404         | Requested resource does not exist            |
| `BusinessRuleException`   | 422         | Domain logic violation (e.g., low balance)   |
| `ConflictException`       | 409         | Duplicate resource, unique constraint clash  |
| `ExternalServiceException`| 503         | Third-party API failure or unavailability    |
| `ForbiddenException`      | 403         | Insufficient permissions or role mismatch    |
| `InternalException`       | 500         | Unexpected server-side errors                |
| `TooManyRequestsException`| 429         | Rate limit exceeded                          |

## Domain Categories

| Category     | Leaf Count | Examples                                                            |
| ------------ | ---------- | ------------------------------------------------------------------- |
| `auth/`      | 10         | `InvalidCredentialsException`, `TokenExpiredException`, `AccountLockedException` |
| `backtest/`  | 3          | `AlgorithmNotRegisteredException`, `QuoteCurrencyNotFoundException` |
| `external/`  | 5          | `ExchangeUnavailableException`, `ExchangeRateLimitedException`     |
| `order/`     | 7          | `InsufficientBalanceException`, `SlippageExceededException`        |
| `resource/`  | 12         | `CoinNotFoundException`, `ExchangeKeyNotFoundException`            |

## ErrorCode Enum

58 codes in `error-codes.enum.ts`, following the `DOMAIN.SPECIFIC_ERROR` naming convention:

- `AUTH.*` (11 codes) -- `AUTH.TOKEN_EXPIRED`, `AUTH.INVALID_OTP`
- `FORBIDDEN.*` (3) -- `FORBIDDEN.ADMIN_REQUIRED`
- `VALIDATION.*` (5) -- `VALIDATION.INVALID_INPUT`, `VALIDATION.OUT_OF_RANGE`
- `NOT_FOUND.*` (12) -- `NOT_FOUND.COIN`, `NOT_FOUND.EXCHANGE_KEY`
- `CONFLICT.*` (4) -- `CONFLICT.DUPLICATE_RESOURCE`
- `BUSINESS.*` (13) -- `BUSINESS.INSUFFICIENT_BALANCE`, `BUSINESS.TRADING_SUSPENDED`
- `EXTERNAL.*` (7) -- `EXTERNAL.EXCHANGE_UNAVAILABLE`, `EXTERNAL.COINGECKO_ERROR`
- `INTERNAL.*` (3) -- `INTERNAL.SERVER_ERROR`, `INTERNAL.DATABASE_ERROR`

## Leaf Pattern

Each leaf exception extends the appropriate base type and wires up the `ErrorCode` plus contextual data in its constructor. Constructors accept domain-specific arguments rather than raw strings.

```typescript
export class InsufficientBalanceException extends BusinessRuleException {
  constructor(currency: string, available: number | string, required: number | string) {
    super(`Insufficient ${currency} balance: ${available} < ${required}`,
      ErrorCode.BUSINESS_INSUFFICIENT_BALANCE,
      { currency, available, required });
  }
}
```

## How to Add a New Exception

1. Pick the base type from `base/` that matches the HTTP semantics.
2. Create a leaf class in the correct domain directory (`auth/`, `order/`, etc.).
3. Add a new entry to the `ErrorCode` enum in `error-codes.enum.ts`.
4. Pass the `ErrorCode` and any contextual data up through `super()`.
5. Re-export from the directory's `index.ts`.

## Gotchas

- Always use `ErrorCode` enum values, never raw strings.
- `NotFoundException.forResource()` is a factory method for quick "X not found" errors with consistent messaging -- prefer it for simple cases or use it as a fallback with `NOT_FOUND_RESOURCE`.
- Context objects propagate to the HTTP response and are available to the frontend for debugging; include identifiers but never sensitive data.
- `GlobalExceptionFilter` serializes all `AppException` subclasses automatically -- do not add per-controller exception filters unless you need to override behavior.
