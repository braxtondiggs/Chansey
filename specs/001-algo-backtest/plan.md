# Implementation Plan: Algorithm Backtesting Integration

**Branch**: `001-algo-backtest` | **Date**: 2025-10-23 | **Spec**: specs/001-algo-backtest/spec.md **Input**: Feature
specification from `/specs/001-algo-backtest/spec.md`

## Summary

Connect existing trading algorithms to the centralized backtesting workflow so analysts can run historical and live
replay simulations, capture signals/results in the shared pipeline, and compare algorithm performance without enabling
live order routing.

## Technical Context

**Language/Version**: TypeScript (Nx monorepo targeting Angular 17+/NestJS 10+)  
**Primary Dependencies**: Angular with PrimeNG (frontend), NestJS with TypeORM, BullMQ, Redis, Nx task runners, shared
`api-interfaces` library  
**Storage**: PostgreSQL (primary), Redis (caching/queues)  
**Testing**: Jest unit + integration suites via Nx, contract tests for external integrations per constitution  
**Target Platform**: Web frontend (Angular browser app) + Node.js backend services (NestJS microservices and workers)  
**Project Type**: Nx monorepo with modular microservices (apps/api, apps/chansey, libs/api-interfaces, background
processors)  
**Performance Goals**: Backtests complete within 15 minutes for one-year datasets; replay signal latency under 5
seconds; adhere to constitution p95 API response limits (<200ms CRUD, <500ms aggregations)  
**Constraints**: No live trade execution from backtesting flows; maintain shared data pipeline consistency; respect
auditing, RBAC, and trading governance rules; deterministic historical playback  
**Scale/Scope**: Supports multiple concurrent algorithms and replay sessions; results must cover at least five
algorithms for comparison workflows

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

- **Code Quality**: Plan must outline maintainable updates within existing Nx structure, preserve strict typing, and
  document public APIs.
- **Testing Standards**: Design must include unit + integration coverage for new backtest pipelines and contract
  considerations for exchange data handling.
- **User Experience Consistency**: Frontend artifacts must rely on PrimeNG components and reflect loading/error handling
  for backtest operations.
- **Architectural Consistency**: No new apps/libs; extend apps/api, apps/chansey, background BullMQ processors, and
  shared interfaces.
- **Performance Requirements**: Ensure data pipeline and simulations respect response-time and throughput expectations;
  define caching/queue usage that aligns with existing Redis/BullMQ strategy.

**Post-Phase-1 Review**: Design artifacts (data model, contracts, quickstart) maintain compliance with all gates; no
exceptions requested.

## Project Structure

### Documentation (this feature)

```text
specs/001-algo-backtest/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
└── tasks.md          # created in Phase 2 via /speckit.tasks
```

### Source Code (repository root)

```text
apps/
├── api/                 # NestJS backend modules (algorithms, portfolios, exchanges)
├── chansey/             # Angular frontend using PrimeNG
└── chansey-e2e/         # Cypress end-to-end tests (unused per constitution change)

libs/
└── api-interfaces/      # Shared TypeScript contract definitions

tools/                   # Nx generators and utilities
tests/                   # Centralized Jest configuration helpers
```

**Structure Decision**: Work will extend existing Nx apps (`apps/api`, `apps/chansey`) and supporting BullMQ
processors/services while updating shared contracts in `libs/api-interfaces`. No new apps or libs will be introduced.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --------- | ---------- | ------------------------------------ |
