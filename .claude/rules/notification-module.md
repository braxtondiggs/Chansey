---
description: Multi-channel notification system — email, push, SMS, rate limiting, quiet hours
globs:
  - "apps/api/src/notification/**"
---

# Notification Module

## Overview

16 files. Multi-channel notification system (email, push, SMS stub).

## Channel Adapters

All implement `send(job: NotificationJobData): Promise<boolean>`:

| Channel | Details |
|---------|---------|
| Email | Severity-prefixed subjects (`[URGENT]` critical, `[Alert]` high) |
| Push | `web-push` with VAPID, auto-removes expired (410 Gone) |
| SMS | Stub/no-op |

## NotificationService Flow

1. Check user preferences
2. Rate-limit (Redis SET NX EX 300, 5-min per user+event)
3. Quiet hours check (UTC, midnight-wrap)
4. Enqueue BullMQ job

## Event Listener

`NotificationListener`: `@OnEvent()` for 9 domain events mapped to severity levels.

## Processor

`NotificationProcessor`: persists `Notification` entity first, then dispatches channels independently.

## Entities

- `Notification`: userId, eventType, read/readAt
- `PushSubscription`: endpoint unique

## Infrastructure

- Dedicated Redis on DB 5
- BullMQ queue: `notification` (attempts 3, exponential backoff 5s)

## Quiet Hours

Skip email/SMS except critical; push always allowed.
