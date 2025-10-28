# Data Model: Autonomous Strategy Lifecycle System

## Overview

Lifecycle artifacts span research, validation, production, and monitoring. Core entities center on strategies and their evolving configurations, experiments, scoring outputs, and live deployments. PostgreSQL remains the source of truth; Redis stores transient queue state and telemetry (not modeled here).

```
Strategy ─┬─< StrategyVersion ─┬─< ParameterConfig
          │                    ├─< BacktestRun
          │                    └─< HyperparameterTrial
          │
          ├─< ScorecardEntry
          └─< LiveDeployment ─┬─< MonitoringIncident
                              └─< DeploymentAudit

MarketDataSet ─┬─< BacktestRun
               └─< HyperparameterTrial
```

## Entities

### Strategy

| Field | Type | Constraints / Notes |
|-------|------|---------------------|
| id | UUID | Primary key |
| code | string | Unique human-readable identifier |
| name | string | Display name (research-only) |
| objective | text | High-level thesis |
| ownerId | UUID | References user table |
| eligibleMarkets | string[] | Symbols/exchanges allowed |
| riskCategory | enum(`low`,`moderate`,`high`) | Drives capital guardrails |
| capitalGuardrails | jsonb | Percentage caps per state |
| lifecycleState | enum(`research`,`validation`,`staging`,`production`,`retired`) | Aggregated from latest version/deployment |
| createdAt / updatedAt | timestamptz | Managed by DB |

**Identity rules**: `code` unique; no soft deletes.  
**Relationships**: One-to-many with StrategyVersion, ScorecardEntry, LiveDeployment.

### StrategyVersion

| Field | Type | Constraints / Notes |
|-------|------|---------------------|
| id | UUID | Primary key |
| strategyId | UUID | FK → Strategy |
| versionTag | string | Semantic version (`vYYYY.MM.patch`), unique per strategy |
| submittedBy | UUID | FK → user |
| submittedAt | timestamptz | Required |
| approvalStatus | enum(`pending`,`approved`,`rejected`) | Governs automation eligibility |
| approvalMetadata | jsonb | Reviewer, timestamp, notes |
| changelog | text | Required narrative |
| deterministicSeed | bigint | Used for reproducible runs |

**Lifecycle**: `approvalStatus` transitions `pending → approved/rejected`; edits create new rows, no mutable updates apart from status metadata.

### ParameterConfig

| Field | Type | Constraints / Notes |
|-------|------|---------------------|
| id | UUID | Primary key |
| strategyVersionId | UUID | FK → StrategyVersion |
| label | string | Human-readable identifier |
| parameters | jsonb | Key/value map; include bounds |
| source | enum(`research`,`optimization`,`rollback`) | Tracks origin |
| checksum | string | SHA-256 of sorted params for dedupe |
| createdAt | timestamptz | Required |

**Validation**: `(strategyVersionId, checksum)` unique to avoid duplicates.

### MarketDataSet

| Field | Type | Constraints / Notes |
|-------|------|---------------------|
| id | UUID | Primary key |
| symbolUniverse | string[] | Symbols covered |
| timeframe | enum(`tick`,`1m`,`5m`,`1h`,`1d`) | |
| startAt / endAt | timestamptz | |
| source | enum(`exchange_dump`,`vendor_feed`,`synthetic`) | |
| checksum | string | SHA-256 to ensure immutability |
| qualityFlags | jsonb | Gap indicators, corrections |
| certifiedAt | timestamptz | Required before scheduling |

### BacktestRun

| Field | Type | Constraints / Notes |
|-------|------|---------------------|
| id | UUID | Primary key |
| strategyVersionId | UUID | FK → StrategyVersion |
| parameterConfigId | UUID | FK → ParameterConfig |
| marketDataSetId | UUID | FK → MarketDataSet |
| triggerType | enum(`new_data`,`regime_change`,`version_update`,`manual`) | |
| mode | enum(`historical`,`live_replay`) | |
| regimeBand | enum(`calm`,`neutral`,`turbulent`) | Derived from dataset |
| status | enum(`queued`,`running`,`completed`,`failed`,`cancelled`) | |
| startedAt / completedAt | timestamptz | |
| metrics | jsonb | Sharpe, Sortino, Calmar, drawdown, win-rate |
| telemetryRef | string | Pointer to Redis/observability store |
| warningFlags | jsonb | Data gaps, zero-activity, etc. |

**Indexes**: `(strategyVersionId, status)`, `(triggerType, startedAt desc)`.

### HyperparameterTrial

| Field | Type | Constraints / Notes |
|-------|------|---------------------|
| id | UUID | Primary key |
| strategyVersionId | UUID | FK → StrategyVersion |
| marketDataSetId | UUID | FK → MarketDataSet |
| seed | bigint | Deterministic replication |
| searchMethod | enum(`latin_hypercube`,`bayesian`) | |
| parameters | jsonb | Candidate set |
| trainWindow | daterange | Train segment |
| testWindow | daterange | Test segment |
| resultMetrics | jsonb | Out-of-sample metrics |
| robustnessScore | numeric(5,2) | Aggregated across regimes |
| createdAt | timestamptz | |

**Relationship**: Many trials map to one ParameterConfig once promoted; association created via ParameterConfig.source=`optimization`.

### ScorecardEntry

| Field | Type | Constraints / Notes |
|-------|------|---------------------|
| id | UUID | Primary key |
| strategyId | UUID | FK → Strategy |
| strategyVersionId | UUID | FK → StrategyVersion |
| evaluationDate | date | Batch timestamp |
| normalizedScore | numeric(5,2) | 0–100 |
| riskAdjustedReturns | jsonb | Sharpe/Sortino/Calmar |
| tailRisk | jsonb | Max drawdown, VaR |
| winRateStability | jsonb | Regime-specific stats |
| driftSignals | jsonb | Overfitting/drift metrics |
| recommendation | enum(`promote`,`monitor`,`demote`,`retire`) | |
| generatedBy | UUID | Service account |

**Unique key**: `(strategyId, evaluationDate)` ensures one record per run cycle.

### LiveDeployment

| Field | Type | Constraints / Notes |
|-------|------|---------------------|
| id | UUID | Primary key |
| strategyId | UUID | FK → Strategy |
| strategyVersionId | UUID | FK → StrategyVersion |
| parameterConfigId | UUID | FK → ParameterConfig |
| activationState | enum(`pending`,`active`,`paused`,`rolled_back`,`retired`) | |
| approvedBy | UUID | Production approver |
| approvedAt | timestamptz | |
| capitalAllocation | numeric(12,4) | Percentage of portfolio |
| rolloutWave | enum(`pilot`,`full`) | Optional staged rollout |
| activationStartedAt | timestamptz | |
| activationCompletedAt | timestamptz | |
| rollbackReason | text | Populated when state transitions to rolled_back |

**State transitions**:  
`pending → active` (on successful deployment)  
`active → paused` (manual)  
`active → rolled_back` (automated/manual incident)  
`paused → active` (manual resume)  
`rolled_back → retired` (post-analysis)

### MonitoringIncident

| Field | Type | Constraints / Notes |
|-------|------|---------------------|
| id | UUID | Primary key |
| liveDeploymentId | UUID | FK → LiveDeployment |
| incidentType | enum(`benchmark_lag`,`drawdown`,`risk_threshold`,`regime_shift`,`operational`) | |
| detectedAt | timestamptz | |
| severity | enum(`warning`,`critical`) | Drives notification channel |
| status | enum(`open`,`in_review`,`resolved`,`closed`) | |
| autoActions | jsonb | Capital throttle, pause flags |
| followUpRunId | UUID | FK → BacktestRun (re-test) |
| resolvedAt | timestamptz | |
| notes | text | Analyst commentary |

### DeploymentAudit

| Field | Type | Constraints / Notes |
|-------|------|---------------------|
| id | UUID | Primary key |
| liveDeploymentId | UUID | FK → LiveDeployment |
| action | enum(`promote`,`rollback`,`pause`,`resume`,`capital_update`) | |
| actorId | UUID | User/service |
| actorRole | enum(`research`,`production`,`risk`,`compliance`,`system`) | |
| occurredAt | timestamptz | |
| details | jsonb | Snapshot of configuration, approvals, benchmark metrics |

## Derived Concepts

- **RegimeBand Determination**: Assigned at scheduling from regime service output; stored on BacktestRun/HyperparameterTrial for traceability.
- **Unified Score Calculation**: Executed in analytics service, storing weightings and factor contributions inside ScorecardEntry for reproducibility.
- **Capital Guardrails**: Stored per Strategy; evaluated before promotions and on MonitoringIncident auto-actions.

## Data Volume & Scaling Notes

- Expect 50 active strategies × ~10 runs/day ⇒ 500 BacktestRun records daily; retention policy keeps raw runs for ≥2 years.
- HyperparameterTrial volume heavier during optimization campaigns (~500 trials/run); indexes on `strategyVersionId` and `createdAt` required.
- Audit logs retained for 7 years; partition tables by year to accommodate retention and querying.

## Referential Integrity & Cascades

- `Strategy` deletion forbidden while dependent records exist; archival handled by `lifecycleState`.
- Cascading delete from StrategyVersion to ParameterConfig, BacktestRun, HyperparameterTrial only allowed for versions still in `pending` status; otherwise, soft-retire via lifecycle.
- `MonitoringIncident` references `followUpRunId` nullable; integrity enforced by application when re-tests complete.
