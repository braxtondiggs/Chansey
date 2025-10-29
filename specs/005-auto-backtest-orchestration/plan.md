# Implementation Plan: Automated Backtesting Orchestration

**Branch**: `005-auto-backtest-orchestration` | **Date**: 2025-10-28 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/005-auto-backtest-orchestration/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Extend the existing backtesting infrastructure to support fully automated strategy generation, evaluation, and deployment. The system will orchestrate 60+ strategies per evaluation cycle through walk-forward analysis, score them using risk-adjusted metrics, promote top performers to live trading (max 35 concurrent), and continuously monitor for drift and market regime changes. Implementation leverages the existing NestJS/TypeORM backend with BullMQ for job orchestration and adds new modules for strategy management, market regime detection, and audit logging.

## Technical Context

**Language/Version**: TypeScript 5.x with Node.js 22+
**Primary Dependencies**: NestJS 11, TypeORM 0.3, BullMQ, PostgreSQL 15+, Redis, TanStack Query (frontend)
**Storage**: PostgreSQL for persistent data (strategies, audit logs), Redis for caching and job queues, 5-year retention for audit data
**Testing**: Jest + Supertest for unit/integration tests, Cypress for E2E validation
**Target Platform**: Linux server (containerized), Angular 20 frontend, responsive web dashboard
**Project Type**: Web application (NestJS backend + Angular frontend in Nx monorepo)
**Performance Goals**: Process 60 strategies in 4 hours, <500ms API response p95, <2s dashboard load, 15 strategies/hour throughput
**Constraints**: Max 35 concurrent live strategies, 5-year audit retention, 99.9% uptime, <20% strategy loss tolerance
**Scale/Scope**: Support 200 strategies per cycle, 100 concurrent live strategies, 50 dashboard users, 10-year data retention capability

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Principle Evaluation

✅ **I. Code Readability & Human-First Design**
- Strategy configurations and scoring logic will use clear naming conventions
- Audit logs will be human-readable with explicit decision reasoning
- Dashboard will provide intuitive visualizations of complex metrics

✅ **II. Type Safety & Predictability**
- All strategy configurations, market data, and scoring metrics fully typed
- Shared interfaces in api-interfaces library for frontend-backend contracts
- No `any` types permitted in strategy evaluation logic

✅ **III. Automated Testing as Foundation**
- Critical trading logic requires 95%+ test coverage
- Walk-forward analysis includes overfitting protection tests
- Strategy promotion gates tested with historical data simulations
- Rollback mechanisms tested with failure scenarios

✅ **IV. Clear Architectural Separation**
- Backend: New NestJS modules for strategy, scoring, monitoring
- Frontend: Angular components for dashboard visualization
- Shared: DTOs and interfaces in api-interfaces library
- No cross-domain imports outside defined interfaces

✅ **V. Automated Quality Enforcement**
- ESLint rules for new strategy modules
- Pre-commit hooks for test execution
- CI/CD pipeline validates strategy scoring consistency
- Performance budgets enforced for dashboard load times

✅ **VI. Transparency & Observability**
- Every strategy decision logged with full parameters
- Market regime changes tracked with timestamps
- Correlation IDs link strategy evaluations to outcomes
- Audit trail provides complete decision history

✅ **VII. Security & Data Protection**
- Strategy parameters encrypted at rest
- Role-based access control for deployment permissions
- Audit logs cryptographically signed
- API rate limiting on strategy endpoints

✅ **VIII. Performance & Scalability**
- BullMQ handles parallel strategy evaluation
- Redis caches frequently accessed metrics
- Database indexes on strategy queries
- Dashboard uses pagination for large datasets

✅ **IX. Data-Driven Simplicity**
- Start with basic scoring metrics (Sharpe, drawdown)
- Add complexity only when metrics prove insufficient
- YAGNI applied to advanced ML features initially
- Measure effectiveness before adding optimization

**Gate Status**: PASSED - All constitution principles satisfied

## Project Structure

### Documentation (this feature)

```text
specs/005-auto-backtest-orchestration/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (Nx Monorepo Structure)

```text
apps/api/src/
├── strategy/                    # Strategy management module
│   ├── strategy.module.ts
│   ├── strategy.controller.ts
│   ├── strategy.service.ts
│   ├── entities/
│   │   ├── strategy-config.entity.ts
│   │   ├── backtest-run.entity.ts
│   │   └── deployment.entity.ts
│   └── dto/
│       ├── create-strategy.dto.ts
│       └── strategy-score.dto.ts
├── scoring/                     # Scoring engine module
│   ├── scoring.module.ts
│   ├── scoring.service.ts
│   └── metrics/
│       ├── sharpe-ratio.calculator.ts
│       ├── drawdown.calculator.ts
│       └── correlation.calculator.ts
├── market-regime/               # Market regime detection
│   ├── market-regime.module.ts
│   ├── market-regime.service.ts
│   └── volatility.calculator.ts
├── monitoring/                  # Performance monitoring
│   ├── monitoring.module.ts
│   ├── drift-detector.service.ts
│   └── alert.service.ts
├── audit/                       # Audit logging module
│   ├── audit.module.ts
│   ├── audit.service.ts
│   └── entities/
│       └── audit-log.entity.ts
└── tasks/                       # Background job tasks
    ├── strategy-evaluation.task.ts
    ├── promotion-gate.task.ts
    ├── drift-detection.task.ts
    └── market-regime.task.ts

apps/chansey/src/app/
├── backtest/                    # Backtesting UI module
│   ├── dashboard/
│   │   ├── strategy-dashboard.component.ts
│   │   └── strategy-dashboard.component.html
│   ├── scorecard/
│   │   ├── strategy-scorecard.component.ts
│   │   └── strategy-scorecard.component.html
│   ├── monitoring/
│   │   ├── performance-monitor.component.ts
│   │   └── drift-alerts.component.ts
│   └── services/
│       ├── strategy.service.ts
│       └── backtest.query.ts

libs/api-interfaces/src/lib/
├── strategy/
│   ├── strategy-config.interface.ts
│   ├── backtest-result.interface.ts
│   ├── scoring-metrics.interface.ts
│   └── deployment-status.interface.ts
├── market/
│   └── market-regime.interface.ts
└── audit/
    └── audit-entry.interface.ts

apps/api/src/migrations/
├── [timestamp]-create-strategy-tables.ts
├── [timestamp]-create-audit-tables.ts
└── [timestamp]-add-market-regime-tables.ts
```

**Structure Decision**: Nx monorepo structure with new NestJS modules in apps/api for backend functionality, Angular components in apps/chansey for dashboard UI, and shared interfaces in libs/api-interfaces. This maintains clear separation between domains while enabling type-safe communication across the stack.

## Complexity Tracking

> **No violations - all constitution principles satisfied**

The implementation maintains simplicity by:
- Leveraging existing infrastructure (BullMQ, TypeORM, Redis)
- Using established patterns from current codebase
- Starting with basic metrics before adding complexity
- Reusing existing authentication and role systems

## Phase Status

### Phase 0: Research ✅ Complete
- Research document: [research.md](research.md)
- All technical decisions documented
- No unresolved NEEDS CLARIFICATION items
- Best practices and implementation guidance provided

### Phase 1: Design ✅ Complete
- Data model: [data-model.md](data-model.md)
- API contracts: [contracts/api-contract.yaml](contracts/api-contract.yaml)
- Quickstart guide: [quickstart.md](quickstart.md)
- Agent context updated with new technologies

### Phase 2: Planning Complete
This implementation plan is ready for task generation via `/speckit.tasks` command.
