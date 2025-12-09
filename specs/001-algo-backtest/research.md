# Research: Algorithm Backtesting Integration

Phase 0 consolidates technical discoveries and defaults used for subsequent design work.

## 1. Backtest Orchestration

- Decision: Run both historical and replay simulations through dedicated BullMQ queues managed by NestJS services within
  `apps/api`.
- Rationale: BullMQ already underpins background processing; leveraging dedicated queues keeps execution off the request
  thread, scales horizontally, and aligns with constitution requirements for background job isolation.
- Alternatives considered:
  - Direct NestJS service invocation on HTTP thread (rejected: would block API, violate performance constraints).
  - Spinning up a new microservice outside Nx (rejected: violates architectural consistency and brownfield mandates).

## 2. Data Consistency & Persistence

- Decision: Persist backtest runs, configuration metadata, and results via TypeORM entities stored in PostgreSQL, with
  Redis used only for transient queue state.
- Rationale: PostgreSQL offers durability, auditing, and traceability required for governance; fits existing TypeORM
  architecture and audit requirements.
- Alternatives considered:
  - Storing results solely in Redis (rejected: lacks durability and fails audit obligations).
  - Creating a separate analytics warehouse upfront (rejected: unnecessary initial complexity; can evolve later).

## 3. Historical Playback Mechanics

- Decision: Stream historical market data into algorithm executors in chronological batches, validating data integrity
  before execution and logging anomalies per run.
- Rationale: Ensures deterministic replay, supports gap detection edge case, and keeps algorithms versioned with the
  data slice used.
- Alternatives considered:
  - Bulk-processing entire dataset without streaming (rejected: increases memory footprint, reduces ability to detect
    mid-run issues).
  - Allowing algorithms to request live exchange data (rejected: violates "no live trading" constraint).

## 4. Live Replay Safeguards

- Decision: Route live replay through a sandboxed execution context that intercepts outbound order calls and records
  them as simulated actions while providing near real-time telemetry through Redis pub/sub to the reporting pipeline.
- Rationale: Meets requirement to observe behavior without risking live orders, leverages existing Redis infrastructure
  for low-latency updates.
- Alternatives considered:
  - Disabling order pathways entirely (rejected: prevents recording intended trades, undermining analysis).
  - Allowing conditional live routing (rejected: conflicts with spec constraint forbidding live trading).

## 5. Frontend Reporting Experience

- Decision: Surface run initiation, progress, and comparison dashboards in Angular using PrimeNG data components with
  TanStack Query for data fetching and caching.
- Rationale: Aligns with constitution UX principles, provides responsive updates, and reuses established frontend stack.
- Alternatives considered:
  - Building custom charting without PrimeNG foundations (rejected: breaks UX consistency).
  - Deferring comparison UI until later (rejected: P3 user story requires immediate planning path).
