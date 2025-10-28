# Implementation Plan: Autonomous Strategy Lifecycle System

**Branch**: `001-algo-backtest` | **Date**: 2025-10-30 | **Spec**: `specs/001-algo-backtest/spec.md`
**Input**: Feature specification from `specs/001-algo-backtest/spec.md`

## Summary

Deliver an end-to-end autonomous lifecycle for algorithmic trading strategies that governs registration, automated validation, unified scoring, safe deployment, and continuous monitoring within the existing Nx monorepo. The solution extends NestJS services, BullMQ workers, Angular dashboards, and shared contracts to orchestrate strategy events, automate backtesting and optimization, enforce capital controls, and expose transparent audit and oversight capabilities.

## Technical Context

**Language/Version**: TypeScript (Node.js 20)  
**Primary Dependencies**: Nx 19+, NestJS 10, Angular 17 with PrimeNG, TypeORM, BullMQ, Redis, TanStack Query, Jest, Swagger  
**Storage**: PostgreSQL (primary relational store), Redis (caching, queues, telemetry streams)  
**Testing**: Jest unit and integration suites via Nx; contract tests for external market/exchange integrations; Cypress retained but not expanded  
**Target Platform**: Web frontend (Angular browser app) and Node.js backend services/workers (NestJS microservices, BullMQ processors)  
**Project Type**: Nx monorepo composed of `apps/api`, `apps/chansey`, supporting workers, and shared `libs/api-interfaces` contracts  
**Performance Goals**: Backtest scheduling latency ≤5 minutes per trigger, unified scorecard generation ≤2 minutes for 80 strategies, live deployment activation ≤5 minutes from approval, monitoring refresh ≤60 seconds  
**Constraints**: Compliance with Chansey constitution (strict TypeScript, PrimeNG UX, RESTful APIs), p95 API latency <200ms (<500ms for aggregations), deterministic backtests, zero live orders from validation flows, automated rollback within 2 minutes of breach  
**Scale/Scope**: Support ≥50 concurrent strategies undergoing validation, scorecard generation for up to 80 strategies per run, multi-exchange deployment (Binance US, Coinbase), multi-role governance (research, production, risk, compliance)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code Quality**: Plan must extend existing NestJS/Angular modules without violating lint/formatting or introducing untyped code.
- **Testing Standards**: Each new API/worker pathway requires Jest integration coverage; external exchange interactions demand contract tests.
- **User Experience Consistency**: New dashboards must employ PrimeNG components, TanStack Query loading patterns, and WCAG 2.1 AA compliance.
- **Architectural Consistency**: No new apps/libs; reuse `apps/api`, `apps/chansey`, BullMQ queues, and `libs/api-interfaces`. Schema changes require TypeORM migrations.
- **Performance Requirements**: Uphold p95 API targets, enforce queue efficiency, ensure telemetry observability within 2 minutes.

All gates are achievable with the outlined approach; proceed to research.

## Project Structure

### Documentation (this feature)

```text
specs/001-algo-backtest/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
└── tasks.md          # produced later via /speckit.tasks
```

### Source Code (repository root)

```text
apps/
├── api/                 # NestJS services, modules, BullMQ processors (strategy, backtest, deployment)
├── chansey/             # Angular standalone components, PrimeNG dashboards, TanStack Query clients
└── chansey-e2e/         # Cypress (unchanged)

libs/
└── api-interfaces/      # Shared DTOs and contracts for backtesting, strategies, monitoring

tools/
└── redis-flush.js       # Utility scripts (unchanged; reuse for local workflows)
```

**Structure Decision**: Continue leveraging the established Nx layout—extend `apps/api` modules for strategy governance, queue processors for automation, and `apps/chansey` for lifecycle dashboards while expanding `libs/api-interfaces` for shared contracts. No new applications or libraries introduced.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | – | – |

### Post-Design Constitution Check (Phase 1)

- **Code Quality**: Data model and API contracts uphold strict typing, reuse existing modules, and avoid new applications—compliant.
- **Testing Standards**: Contracts identify endpoints requiring Jest integration coverage and monitoring-driven regression tests.
- **User Experience Consistency**: Quickstart and dashboard plan reaffirm PrimeNG + TanStack Query usage with role-based tabs.
- **Architectural Consistency**: Plan confines changes to `apps/api`, `apps/chansey`, BullMQ processors, and `libs/api-interfaces`; no constitution violations detected.
- **Performance Requirements**: Research clarifies latency/throughput targets (e.g., 5-minute trigger, 2-minute scorecard) consistent with spec and constitution expectations.
