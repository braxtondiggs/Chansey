# Tasks: Algorithm Backtesting Integration

**Input**: Design documents from `/specs/001-algo-backtest/` **Prerequisites**: plan.md (required), spec.md (required
for user stories), research.md, data-model.md, contracts/

**Tests**: Include targeted integration tests for high-risk backtesting flows.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Align environment variables and baseline configuration for historical & live replay processing.

- [x] T001 Update `.env.example` with `BACKTEST_HISTORICAL_QUEUE`, `BACKTEST_REPLAY_QUEUE`, `BACKTEST_TELEMETRY_STREAM`,
      and concurrency defaults.
- [x] T002 Create `apps/api/src/order/backtest/backtest.config.ts` exporting typed accessors for new backtesting
      environment variables.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core domain, migration, and shared contract updates required before any user story work.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Extend `apps/api/src/order/backtest/backtest.entity.ts` with config snapshot, deterministic seed, warning
      flags, and new entities `BacktestSignal` and `SimulatedOrderFill`.
- [x] T004 Create `apps/api/src/order/backtest/market-data-set.entity.ts` for curated historical/replay datasets with
      integrity metadata.
- [x] T005 Update `apps/api/src/order/order.module.ts` to register new entities/services and configure BullMQ queues for
      `backtest-historical` and `backtest-replay` using `backtest.config`.
- [x] T006 Generate `apps/api/src/migrations/20251023170000-algo-backtest-foundation.ts` adding tables for market data
      sets, signals, simulated fills, comparison reports, and new columns on `backtests`.
- [x] T007 Add shared TypeScript contracts under `libs/api-interfaces/src/lib/backtesting/` and update
      `libs/api-interfaces/src/lib/api-interfaces.ts` exports for runs, signals, datasets, and comparison reports.
- [x] T008 Implement Redis-backed telemetry pipeline in `apps/api/src/order/backtest/backtest-stream.service.ts` to
      publish structured logs, metrics, and traces per run.
- [x] T009 Add dataset ingestion script `apps/api/src/order/backtest/scripts/market-data-import.ts` plus
      `seed-backtest-datasets` target in `apps/api/project.json` for loading replay-ready data slices.

---

## Phase 3: User Story 1 - Validate algorithms against historical data (Priority: P1) 🎯 MVP

**Goal**: Analysts can launch historical backtests for approved algorithms, capture signals/trades, and review metrics
without live execution.

**Independent Test**: POST `/backtests` with historical mode, wait for completion, and verify signals/trades/metrics
render in the Backtesting page using stored dataset + config snapshot.

### Tests for User Story 1 ⚠️

- [x] T010 [P] [US1] Add integration test `apps/api/src/order/backtest/backtest.historical.spec.ts` covering POST
      `/backtests` → queued job + persisted run metadata.

### Implementation for User Story 1

- [x] T011 [US1] Refactor `apps/api/src/order/backtest/backtest.controller.ts` to expose `/backtests` list/detail plus
      paginated `/backtests/{id}/signals` and `/backtests/{id}/trades` responses using shared DTOs.
- [x] T012 [US1] Update `apps/api/src/order/backtest/backtest.service.ts` to snapshot algorithm parameters, bind
      selected `MarketDataSet`, enqueue historical jobs, and surface run warnings via `BacktestStreamService`.
- [x] T013 [US1] Enhance `apps/api/src/order/backtest/backtest.processor.ts` to execute strategy via
      `algorithm/registry`, persist `BacktestSignal` & `SimulatedOrderFill`, and publish telemetry events.
- [x] T014 [P] [US1] Extend `apps/api/src/order/backtest/backtest-engine.service.ts` with deterministic seeding, dataset
      streaming helpers, and telemetry payload assembly.
- [x] T015 [US1] Implement historical signal/trade query helpers in `apps/api/src/order/backtest/backtest.service.ts`
      supporting pagination and filter options.
- [x] T016 [P] [US1] Create Angular API client `apps/chansey/src/app/shared/services/backtesting.service.ts` with
      TanStack-friendly methods for runs, signals, trades, and dataset catalog.
- [x] T017 [P] [US1] Add backtesting query keys & adapters in `apps/chansey/src/app/core/query/query.keys.ts` and
      related utilities for caching.
- [x] T018 [US1] Build historical run management page
      `apps/chansey/src/app/pages/backtesting/historical-run.component.ts` (+ template/styles) with forms for
      algorithm/dataset selection and results table.
- [x] T019 [US1] Update navigation via `apps/chansey/src/app/app.routes.ts` and
      `apps/chansey/src/app/layout/app.menu.ts` to expose `/app/backtesting` route and label historical tab.

**Checkpoint**: Historical backtesting can be run, observed, and audited independently.

---

## Phase 4: User Story 2 - Observe algorithm behavior in simulated live replay (Priority: P2)

**Goal**: Developers can replay recent market activity in live mode, watch streaming telemetry, and ensure outbound
trades remain simulated.

**Independent Test**: POST `/backtests` with `mode=live_replay`, subscribe to websocket feed, observe streaming signals
within <5s latency, and confirm cancel/resume endpoints manage state without live orders.

### Tests for User Story 2 ⚠️

- [x] T020 [P] [US2] Add integration test `apps/api/src/order/backtest/backtest.replay.spec.ts` verifying live replay
      job creation and websocket broadcast envelope.

### Implementation for User Story 2

- [x] T021 [US2] Add `apps/api/src/order/backtest/live-replay.processor.ts` to stream recorded market data, intercept
      outbound orders, and emit telemetry through `BacktestStreamService`.
- [x] T022 [US2] Extend `apps/api/src/order/backtest/backtest.service.ts` to schedule live replay jobs, gate live order
      routing, and manage resume/cancel transitions with audit history.
- [x] T023 [P] [US2] Introduce websocket gateway `apps/api/src/order/backtest/backtest.gateway.ts` broadcasting run
      progress, signals, and warnings to subscribed clients.
- [x] T024 [US2] Update `apps/api/src/order/backtest/backtest.controller.ts` to wire `/backtests/{id}/cancel` and
      `/backtests/{id}/resume` endpoints to the live replay workflow and gateway notifications.
- [x] T025 [P] [US2] Create live replay viewer component
      `apps/chansey/src/app/pages/backtesting/live-replay.component.ts` consuming websocket telemetry with PrimeNG
      streaming UI.
- [x] T026 [US2] Add UI toggle & simulation banner within
      `apps/chansey/src/app/pages/backtesting/backtesting-shell.component.ts` to switch modes and highlight “simulation
      only” safeguards.

**Checkpoint**: Live replay mode streams telemetry with safeguards without depending on comparison workflows.

---

## Phase 5: User Story 3 - Compare algorithm performance for decision making (Priority: P3)

**Goal**: Portfolio managers can assemble comparison reports across runs, filter by timeframe/regime, and export aligned
metrics for review.

**Independent Test**: POST `/comparison-reports` with ≥2 run IDs, retrieve `/comparison-reports/{id}`, and confirm
Angular dashboard filters/exports operate without historical or live flows rerunning.

### Tests for User Story 3 ⚠️

- [x] T027 [P] [US3] Add integration test `apps/api/src/order/backtest/backtest.comparison.spec.ts` covering comparison
      report creation and retrieval endpoints.

### Implementation for User Story 3

- [x] T028 [US3] Implement comparison aggregation in `apps/api/src/order/backtest/backtest.service.ts` (or dedicated
      service) calculating metrics, benchmarks, and notes storage.
- [x] T029 [US3] Expose `/comparison-reports` endpoints in `apps/api/src/order/backtest/backtest.controller.ts`
      returning shared interface payloads.
- [x] T030 [P] [US3] Extend front-end client `apps/chansey/src/app/shared/services/backtesting.service.ts` & query
      adapters for comparison report APIs.
- [x] T031 [US3] Build comparison dashboard `apps/chansey/src/app/pages/backtesting/comparison-dashboard.component.ts`
      with filters, benchmark overlays, and CSV/PDF export helper.

**Checkpoint**: Comparison workflows deliver actionable reports independent of live replay execution.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Observability, documentation, and finishing touches spanning all user stories.

- [ ] T032 Instrument structured logging, metrics, and trace spans across
      `apps/api/src/order/backtest/backtest.service.ts`, processors, and gateway leveraging `BacktestStreamService`.
- [ ] T033 Populate `specs/001-algo-backtest/quickstart.md` with updated run, monitoring, and troubleshooting steps.
- [ ] T034 Update root `README.md` with backtesting workflow summary, simulation safeguards, and links to comparison
      reporting.

---

## Dependencies & Execution Order

1. **Phase 1 → Phase 2**: Environment + config updates must precede domain/migration work.
2. **Phase 2 → User Stories**: All foundational tasks (T003–T009) required before US1/US2/US3 can proceed.
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
# Live replay backend pieces
tasks: T021, T023
# Frontend live UI work
tasks: T025, T026
```

### User Story 3

```bash
# Comparison backend vs frontend
backend task: T028
frontend tasks: T030, T031
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

- Backend engineer: Phase 2 → US1 (T012–T015) → US2 processors/gateway (T021–T024).
- Frontend engineer: US1 UI (T016–T019) → US2 live components (T025–T026) → US3 dashboard (T030–T031).
- Platform engineer: Observability + docs (T032–T034) concurrent once APIs stabilize.
