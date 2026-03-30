---
description: User settings page — account, trading, security, notifications, appearance tabs
globs:
  - "apps/chansey/src/app/pages/user/**"
---

# User Pages

## Overview

28 files. Settings page with 5 tabs synced to `?tab=` query param.

## Tab Shell

`SettingsComponent` with fragment scroll on init.

## Sub-Components (10)

| Component | Purpose |
|-----------|---------|
| `AccountSettingsComponent` | Profile, avatar (ImageCropComponent), email-change confirmation + auto-logout |
| `TradingSettingsComponent` | Risk profile, opportunity selling, futures toggle, exchange keys. `createAutoSave()` for toggles |
| `SecuritySettingsComponent` | OTP enable/disable, embeds `ChangePasswordComponent` |
| `NotificationSettingsComponent` | Channel/event toggles, quiet hours, browser Notification API for push |
| `AppearanceSettingsComponent` | PrimeNG `$t()` theme switching — preset, colors, dark mode, menu mode |
| `ExchangeIntegrationsComponent` | Tabbed exchange list |
| `ExchangeKeyFormComponent` | Masked key fields |
| `ChangePasswordComponent` | Password change form |
| `ProfileInfoComponent` | Profile display/edit |
| `SaveStatusIndicatorComponent` | Auto-save status feedback |

## Utilities

- `createAutoSave(saveFn, 500ms)` — signal-based status with auto-reset
- `createPanelState()` — localStorage collapsed state

## Services

`SettingsService` (TanStack queries), `NotificationSettingsService`.

## Patterns

- Forms via `effect()` with `{ emitEvent: false }`
- Masked keys (`'••••'`) in disabled fields
