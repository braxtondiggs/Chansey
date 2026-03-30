---
description: JWT auth with Passport strategies, OTP, security audit logging
globs:
  - "apps/api/src/authentication/**"
---

# Authentication Module

## Overview

39 files. JWT auth with Passport strategies, OTP, and security audit logging.

## Strategies

| Strategy | Details |
|----------|---------|
| `JwtStrategy` | HS512, Bearer header or `chansey_access` cookie |
| `LocalStrategy` | Email/password |
| `ApiKeyStrategy` | `Api-Key` header |

## Guards

- `JwtAuthenticationGuard` — standard JWT
- `LocalAuthenticationGuard` — login form
- `OptionalJwtAuthenticationGuard` — returns null if unauthenticated
- `RolesGuard` — reads `@Roles()` metadata
- `WsJwtAuthenticationGuard` — Socket.IO: `handshake.auth.token` → header → cookie → query

## Decorators

- `@GetUser()` — extracts user from request
- `@Roles(...roles)` — sets required roles

## Tokens

- Access: HS512, 15min. Refresh: HS512, 7d/30d
- HttpOnly cookies: `chansey_access`/`chansey_refresh`, `SameSite=Strict`

## OTP

6-digit, bcrypt 6 rounds, emailed, verified via `POST /authentication/verify-otp`.

## Security

- Lockout: 5 failed attempts → 15-min lockout
- Anti-enumeration on forgot/resend endpoints
- `SecurityAuditLog`: 15 event types, indexed `[userId, createdAt]`. Failures never throw
- `PasswordService`: standalone injectable (bcrypt + crypto)
- `@AuthThrottle()` on all routes

## Gotcha

`JwtModule.register({})` is empty — signing config is per-call in `RefreshTokenService`.
