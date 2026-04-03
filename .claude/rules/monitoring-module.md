---
description: Post-deployment drift detection and alerting for live strategies
globs:
  - "apps/api/src/monitoring/**"
---

# Monitoring Module

## Overview

12 files. Post-deployment drift detection and alerting for live strategies.

## Drift Detectors

All implement `detect(deployment, latestMetric): Promise<DriftAlert | null>`:

| Detector | Warning/High/Critical Thresholds |
|----------|----------------------------------|
| Sharpe | 30% / 50% / 70% |
| Return | 40% / 60% / 80% (negative always critical) |
| Drawdown | threshold-based |
| WinRate | threshold-based |
| Volatility | threshold-based |

## Orchestration

`DriftDetectorService`: runs all 5 sequentially → persists `DriftAlert` → updates Deployment fields → audit log.

## DriftAlert Entity

- Indexed `[deploymentId, createdAt]`
- Resolution: `manual / auto-demotion / ignored`
- Computed properties: `isActive`, `isCritical`, `daysOpen`

## MonitoringService

- `getLatestMetric()` — most recent performance snapshot
- `compareToBacktest()` — live vs historical comparison
- `getRollingStatistics(windowDays)` — windowed aggregation
- `getPerformanceTrend()` — 7d vs 30d comparison

## Alert Escalation

- Emits `NOTIFICATION_EVENTS.DRIFT_ALERT`
- Unresolved high/critical >24h → emits `RISK_BREACH`

## Templates

`DriftAlertTemplate`: static class for email HTML, Slack attachments, SMS with severity coloring.

## Pattern

Detectors return unpersisted alert or null → orchestrator persists → alert service notifies.
