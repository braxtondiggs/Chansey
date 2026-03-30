---
description: Frontend auth pages — login, register, OTP, password reset flows
globs:
  - "apps/chansey/src/app/pages/auth/**"
---

# Auth Pages

## Overview

6 auth flows, each with 3 files: `component.ts`, `component.html`, `service.ts` + barrel `index.ts`.

## Pattern

- Standalone component + `providedIn: 'root'` service with `useAuthMutation()`
- No state stored in services — all transient

## Feedback System

`signal<AuthMessage[]>([])` with `{ content, severity, icon }`. Displayed via shared `AuthMessagesComponent`.

## Shared UI Components

- `AuthPageShellComponent` — two-panel layout
- `PasswordRequirementsComponent`, `PasswordMatchValidator`, `PasswordStrengthValidator`

## Error Handling

Use `isApiError(error)` + `error.hasCode(ErrorCodes.X)` from `@chansey/shared` (never string matching).

## Flow-Specific Notes

| Flow | Detail |
|------|--------|
| **Login** | Handles OTP redirect via `sessionStorage` (`otpEmail`, `otpRemember`) |
| **OTP** | Auto-submits when 6-digit code complete. Email censored: `replace(/(.{2})(.*)(@.*)/, '$1****$3')` |
| **New Password** | Reads `?token=` from query params. `AUTH_REDIRECT_DELAY = 3000ms` + `timer()` redirect |
| **Register** | Uses `getRawValue()` (not `.value`) to bypass disabled controls |

## API Interfaces

Import from `@chansey/api-interfaces` (e.g., `ILogin`, `ILoginResponse`, `IRegister`).
