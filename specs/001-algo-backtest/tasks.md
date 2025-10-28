# Tasks: Autonomous Strategy Lifecycle System

**Input**: Design documents from `/specs/001-algo-backtest/` **Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Integration tests added for automation, optimization, deployment, and monitoring flows due to financial risk profile.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing for each slice.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Align environment variables, feature flags, and baseline configuration needed for autonomous lifecycle execution.

- [ ] T001 Update `apps/api/.env.example` with `AUTONOMOUS_LIFECYCLE_ENABLED`, `REGIME_SERVICE_URL`, benchmark weights, and alert channel keys.
- [ ] T002 Extend `apps/api/src/config/feature-flags.config.ts` to expose autonomous lifecycle toggles throughout the API.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish core entities, migrations, queue wiring, and shared contracts required by all stories.

- [ ] T003 Create strategy governance entities in `apps/api/src/strategy/entities/strategy.entity.ts` covering Strategy, StrategyVersion, and ParameterConfig per data model.
- [ ] T004 Implement validation run entities in `apps/api/src/strategy/entities/validation-run.entity.ts` for MarketDataSet, BacktestRun, and HyperparameterTrial.
- [ ] T005 Add scoring and deployment entities in `apps/api/src/strategy/entities/lifecycle-metrics.entity.ts` for ScorecardEntry, LiveDeployment, MonitoringIncident, and DeploymentAudit.
- [ ] T006 Generate TypeORM migration `apps/api/src/migrations/20251030-autonomous-lifecycle-foundation.ts` creating new tables, indexes, and enums.
- [ ] T007 Register lifecycle module providers in `apps/api/src/strategy/strategy.module.ts` including repositories, services, and guards.
- [ ] T008 Expand shared contracts in `libs/api-interfaces/src/lib/strategy-lifecycle/` with DTOs for strategies, runs, scorecards, deployments, incidents, and audits.
- [ ] T009 Configure BullMQ queues in `apps/api/src/strategy/queues/lifecycle.queue.ts` for validation scheduling, optimization, scoring, deployment activation, and monitoring.
- [ ] T010 Seed Nx targets in `apps/api/project.json` for new queue workers (`validation-scheduler`, `optimization-engine`, `deployment-activation`, `monitoring-watchdog`).

---

## Phase 3: User Story 1 - Register and govern strategies (Priority: P0) 🎯 MVP

**Goal**: Research leads can register strategies, manage versions, and enforce role-based governance with immutable history.

**Independent Test**: POST `/strategies` and `/strategies/{id}/versions`, verify history via GET, and ensure unauthorized roles receive 403.

- [ ] T011 [US1] Implement strategy controller endpoints in `apps/api/src/strategy/strategy.controller.ts` for listing, registration, and version submission.
- [ ] T012 [US1] Build strategy service logic in `apps/api/src/strategy/strategy.service.ts` enforcing RBAC, lifecycle transitions, and version immutability.
- [ ] T013 [US1] Add Jest integration test `apps/api/src/strategy/strategy.controller.spec.ts` covering registration, version history, and permission failures.
- [ ] T014 [US1] Extend Angular research tab container `apps/chansey/src/app/pages/strategy-lifecycle/research-tab.component.ts` with PrimeNG forms for registry actions.
- [ ] T015 [P] [US1] Update API client `apps/chansey/src/app/shared/services/strategy-lifecycle.service.ts` with strategy and version methods plus TanStack Query keys.

---

## Phase 4: User Story 2 - Autonomous backtest scheduling (Priority: P1)

**Goal**: Automatically launch validation runs when new data, regime changes, or version updates occur.

**Independent Test**: Simulate each trigger event, confirm corresponding validation run queued and visible via `/validation/runs`.

- [ ] T016 [US2] Implement event subscribers in `apps/api/src/strategy/automation/trigger.subscriber.ts` for market data, regime, and version update signals.
- [ ] T017 [US2] Build validation scheduler service in `apps/api/src/strategy/automation/trigger.service.ts` orchestrating queue jobs by trigger type.
- [ ] T018 [US2] Add validation run controller endpoints in `apps/api/src/strategy/automation/validation.controller.ts` for listing runs and manual triggers.
- [ ] T019 [P] [US2] Create integration test `apps/api/src/strategy/automation/trigger.spec.ts` verifying automatic scheduling per trigger.
- [ ] T020 [US2] Add automation panel to Angular research tab `apps/chansey/src/app/pages/strategy-lifecycle/research-automation-panel.component.ts` displaying queued runs and restricting manual trigger controls to admin roles.
- [ ] T021 [US2] Update `apps/chansey/src/app/pages/backtesting/index.ts` to restrict manual trigger workflow visibility to admin roles.

---

## Phase 5: User Story 3 - Hyperparameter optimization & walk-forward analysis (Priority: P1)

**Goal**: Execute rolling window optimization with robustness scoring across regimes.

**Independent Test**: POST manual optimization trigger, validate trials recorded with train/test windows and robustness scores accessible via API/UI.

- [ ] T022 [US3] Implement optimization service in `apps/api/src/strategy/optimization/optimization.service.ts` performing Latin hypercube + Bayesian search with deterministic seeds.
- [ ] T023 [US3] Create optimization processor `apps/api/src/strategy/optimization/optimization.processor.ts` handling BullMQ jobs and persisting HyperparameterTrial results.
- [ ] T024 [US3] Expose optimization summaries via API in `apps/api/src/strategy/optimization/optimization.controller.ts`.
- [ ] T025 [P] [US3] Add integration test `apps/api/src/strategy/optimization/optimization.spec.ts` covering trial execution and robustness scoring.
- [ ] T026 [US3] Build Angular optimization view `apps/chansey/src/app/pages/strategy-lifecycle/optimization-panel.component.ts` with PrimeNG tables for trials and regime-specific results.

---

## Phase 6: User Story 4 - Unified scoring and ranking (Priority: P2)

**Goal**: Provide consolidated strategy rankings with risk-adjusted metrics and recommendations.

**Independent Test**: Run scheduled scorecard job, confirm `/scorecards/latest` returns normalized scores and recommendations rendered in UI.

- [ ] T027 [US4] Implement scorecard aggregator in `apps/api/src/strategy/scoring/scorecard.service.ts` calculating weighted metrics and recommendations.
- [ ] T028 [US4] Add scheduled BullMQ job `apps/api/src/strategy/scoring/scorecard.scheduler.ts` to compute scorecards for eligible strategies.
- [ ] T029 [US4] Expose scorecard API in `apps/api/src/strategy/scoring/scorecard.controller.ts` including filtering by lifecycle state.
- [ ] T030 [P] [US4] Update Angular production tab `apps/chansey/src/app/pages/strategy-lifecycle/production-tab.component.ts` to display scorecards, weights, and recommendation badges.

---

## Phase 7: User Story 5 - Safe deployment and rollback (Priority: P2)

**Goal**: Automate promotion with capital guardrails and swift rollback on degradation.

**Independent Test**: Approve deployment via API, verify activation within SLA, simulate benchmark lag to trigger auto-rollback and audit record.

- [ ] T031 [US5] Implement deployment workflow service `apps/api/src/strategy/deployment/deployment.service.ts` enforcing safety gates and capital allocation.
- [ ] T032 [US5] Add deployment action controller `apps/api/src/strategy/deployment/deployment.controller.ts` for approve/rollback/pause/resume operations.
- [ ] T033 [P] [US5] Create integration test `apps/api/src/strategy/deployment/deployment.spec.ts` covering capital guardrails and auto-rollback trigger.
- [ ] T034 [US5] Extend Angular production tab template `apps/chansey/src/app/pages/strategy-lifecycle/production-tab.component.html` with deployment controls and audit snapshots.

---

## Phase 8: User Story 6 - Continuous monitoring and re-evaluation (Priority: P2)

**Goal**: Monitor live strategies, throttle risk, and schedule re-validation when thresholds breach.

**Independent Test**: Feed synthetic telemetry exceeding thresholds, verify incident creation, auto-actions, and scheduled backtest reference.

- [ ] T035 [US6] Implement monitoring engine `apps/api/src/strategy/monitoring/monitoring.service.ts` aggregating live metrics, benchmark drift, and risk thresholds.
- [ ] T036 [US6] Add monitoring controller `apps/api/src/strategy/monitoring/monitoring.controller.ts` for incident retrieval, updates, and linked follow-up runs.
- [ ] T037 [P] [US6] Build monitoring processor `apps/api/src/strategy/monitoring/monitoring.processor.ts` executing auto throttles, rollbacks, and re-validation scheduling.
- [ ] T038 [US6] Create Angular risk tab `apps/chansey/src/app/pages/strategy-lifecycle/risk-tab.component.ts` visualizing incidents, auto-actions, and benchmark comparisons.

---

## Phase 9: User Story 7 - Transparent interfaces and auditability (Priority: P3)

**Goal**: Deliver APIs and UI for audit logs, promotion history, and experiment comparisons accessible to compliance.

**Independent Test**: Query `/audit/events` with filters, export history, and confirm UI surfaces immutable records with download links.

- [ ] T039 [US7] Implement audit controller `apps/api/src/strategy/audit/audit.controller.ts` supporting filtered retrieval and pagination.
- [ ] T040 [US7] Add export service `apps/api/src/strategy/audit/audit-export.service.ts` generating CSV/JSON/PDF artifacts.
- [ ] T041 [P] [US7] Integrate Angular audit panel `apps/chansey/src/app/pages/strategy-lifecycle/audit-log-panel.component.ts` with downloads and access controls.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Finalize observability, docs, and governance alignment across services and UI.

- [ ] T042 Instrument telemetry hooks across `apps/api/src/strategy` services and processors to emit structured logs, metrics, and traces per incident/run.
- [ ] T043 Update `specs/001-algo-backtest/quickstart.md` with lifecycle walkthrough, automation triggers, and troubleshooting additions.
- [ ] T044 Refresh root `README.md` with autonomous lifecycle overview, safety gates, and monitoring instructions.

---

## Dependencies & Execution Order

1. **Phase 1 → Phase 2**: Environment and feature flag setup must precede schema and queue provisioning.
2. **Phase 2 → Phases 3–9**: Foundational entities, migrations, queues, and contracts required before story-specific work.
3. **User Story Dependencies**: US1 lays governance groundwork; US2 and US3 can proceed once entities exist. US4 depends on US3 outputs. US5 requires scorecards (US4). US6 depends on deployments (US5). US7 can parallel US6 once audits exist.

---

## Parallel Execution Examples

- US1 frontend service update (T015) can run parallel to component build after API contracts finalize.
- US2 integration test (T019) can execute alongside automation panel (T020) once scheduler logic exists.
- US3 optimization test (T024) may run in parallel with UI panel (T025) after service/processor land.
- US4 production tab UI (T029) can iterate concurrently with scheduler (T027) once scoring service drafted.
- US6 monitoring processor (T036) can be developed alongside risk tab UI (T037) after monitoring service is stubbed.
- US7 audit panel (T040) can progress in parallel with export service (T039) due to separate files.

---

## Implementation Strategy

1. **MVP (US1)**: Deliver strategy registry and governance APIs with corresponding research UI to unblock lifecycle metadata.
2. **Validation Automation (US2 & US3)**: Stand up autonomous triggers and optimization workflows to populate evaluation data.
3. **Decision & Deployment (US4 & US5)**: Produce unified scorecards feeding promotion workflows with enforced safety gates.
4. **Risk Oversight & Transparency (US6 & US7)**: Add monitoring, incidents, and audit surfaces to close governance loop.
5. **Polish**: Instrument telemetry, update documentation, and ensure guardrails are discoverable for operations teams.
3. **User Story Order**: US1 (historical) unlocks dataset usage; US2 (live replay) depends on shared pipeline from US1
   but can start once Phase 2 is complete and US1 telemetry helpers (T012–T015) land. US3 (comparison) depends on
   persisted metrics from US1 but not on US2.
4. **Polish Phase**: Execute after all desired user stories to finalize observability and documentation.

## Parallel Execution Examples

### User Story 1

```bash
# Backend tasks in parallel after T012 groundwork
tasks: T013, T014, T015
# Frontend data/query layer parallelism
tasks: T016, T017
```

### User Story 2

```bash
# Automation backend pieces
tasks: T016, T017, T018
# Frontend admin controls
tasks: T020, T021
```

### User Story 3

```bash
# Optimization backend vs frontend
backend tasks: T022, T023, T024
frontend tasks: T026
tests: T025
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 & Phase 2 baseline.
2. Deliver Phase 3 (US1) to enable historical runs and reporting.
3. Validate via T010 integration test and UI smoke.

### Incremental Delivery

1. Deploy US1 as MVP.
2. Layer US2 live replay streaming with safeguards.
3. Add US3 comparison dashboards once historical metrics are reliable.

### Parallel Team Strategy

- Backend engineer: Phase 2 → US1 (T012–T015) → US2 automation services (T016–T019).
- Frontend engineer: US1 UI (T014–T015) → US2 admin controls (T020–T021) → US3 dashboard (T026).
- Platform engineer: Observability + docs (T042–T044) concurrent once APIs stabilize.
