<!--
Sync Impact Report (2025-10-28)
==================================
Version Change: 1.0.0 (Initial constitution)
Modified Principles: N/A (initial creation)
Added Sections: All sections newly defined
Removed Sections: None
Templates Requiring Updates:
  ✅ plan-template.md - Constitution Check section aligned
  ✅ spec-template.md - Scope aligns with clarity and testing principles
  ✅ tasks-template.md - Task categorization reflects testing and architecture principles
Follow-up TODOs:
  - TODO(RATIFICATION_DATE): Set to today (2025-10-28) as initial ratification
  - All placeholder tokens replaced with concrete values
-->

# Chansey Constitution

## Core Principles

### I. Code Readability & Human-First Design

Code must serve people first. Every line should be readable, predictable, and adaptable under pressure. We prioritize
clarity over cleverness, ensuring that any developer can understand and modify the codebase quickly. This means
comprehensive documentation, meaningful variable names, and explicit intent in implementation choices.

### II. Type Safety & Predictability

Every contributor commits to maintainability through strict type safety. TypeScript's type system must be leveraged
fully—no `any` types without documented justification. Interfaces, types, and contracts must be explicitly defined. APIs
and services must behave predictably, with clear error states and consistent response patterns across the entire system.

### III. Automated Testing as Foundation

Testing is integral, not auxiliary. Each change must prove its safety through measurable outcomes. Unit tests for
business logic, integration tests for API contracts, and end-to-end tests for critical user paths are mandatory. Test
coverage targets: minimum 80% for new code, with critical financial/trading logic requiring 95%+. Every bug fix must
include a regression test.

### IV. Clear Architectural Separation

The monorepo exists to unify domains, not complicate them. Maintain strict boundaries: Angular frontend, NestJS backend,
shared interfaces. No cross-domain imports except through defined interface packages. Each module must be independently
testable and deployable. Database entities, DTOs, and frontend models must remain separate with explicit mapping layers.

### V. Automated Quality Enforcement

Conventions around structure, linting, and performance are enforced automatically to protect long-term quality.
Pre-commit hooks, CI/CD pipelines, and automated code reviews must catch violations before merge. ESLint, Prettier, and
TypeScript strict mode are non-negotiable. Performance budgets for frontend bundle size and API response times must be
enforced via automated checks.

### VI. Transparency & Observability

Algorithms, APIs, and interfaces must expose reasoning that users can trust. Every trading decision, price calculation,
and portfolio metric must be auditable. Structured logging with correlation IDs, distributed tracing, and comprehensive
error reporting are mandatory. Users must be able to understand why the system made any decision affecting their assets.

### VII. Security & Data Protection

Security is continuous, not a checklist item. API keys must be encrypted at rest and in transit. Authentication tokens
must use secure HttpOnly cookies. Rate limiting, CSRF protection, and input validation are mandatory on all endpoints.
Regular dependency audits and security patches must be applied within 48 hours of disclosure. User financial data
requires audit logs for all access.

### VIII. Performance & Scalability

The system must scale gracefully under load. Background job processing via BullMQ must handle burst traffic without
dropping tasks. Redis caching with appropriate TTLs for market data. Database queries must be optimized with proper
indexing. Frontend must maintain sub-3 second initial load and 60fps interactions. API endpoints must respond within
200ms p95 for reads, 500ms for writes.

### IX. Data-Driven Simplicity

Decisions should be data-driven but human-conscious. Favor simplicity, stability, and clarity over cleverness. Start
with the simplest solution that could work, measure its effectiveness, then optimize based on real usage patterns. YAGNI
(You Aren't Gonna Need It) applies until proven otherwise by metrics. Every complexity addition must be justified with
measurable benefit.

## Development Workflow

### Code Review Requirements

- All code requires review before merge, no self-merging
- Reviews must verify: type safety, test coverage, architectural boundaries
- Security-sensitive changes require two reviewers
- Performance-impacting changes require benchmark results

### Testing Gates

- Pre-commit: Linting, formatting, type checking must pass
- Pre-merge: All unit and integration tests must pass
- Deployment: E2E tests for critical paths must pass
- Rollback plan required for database migrations

### Monitoring & Alerting

- Error rates, response times, and queue depths monitored continuously
- Alerts for: error rate >1%, p95 latency degradation >20%, failed background jobs
- On-call rotation with 15-minute response SLA for production issues
- Post-mortems required for all customer-impacting incidents

## Technical Standards

### Technology Constraints

- Node.js 22+ for all services (consistency across monorepo)
- PostgreSQL for persistent data, Redis for caching only
- TypeORM migrations for all schema changes, no manual SQL in production
- Angular standalone components only, no NgModules
- PrimeNG components preferred over custom UI implementations

### API Standards

- RESTful design with consistent resource naming
- OpenAPI/Swagger documentation required for all endpoints
- Versioning via URL path (/v1, /v2) for breaking changes
- Rate limiting: 100 req/min general, 10 req/min auth endpoints
- Response format: `{ data: T, error?: string, metadata?: {} }`

### Deployment Policies

- Zero-downtime deployments via blue-green strategy
- Feature flags for gradual rollouts of new functionality
- Database migrations must be backward compatible
- Canary deployments for algorithm changes affecting trading

## Governance

This constitution supersedes all development practices and architectural decisions. It serves as the foundation for all
technical choices and must be consulted before introducing new patterns, technologies, or practices.

### Amendment Process

- Proposed changes require RFC (Request for Comments) document
- Minimum 3-day review period for team feedback
- Major changes (new principles) require unanimous approval
- Minor changes (clarifications) require simple majority
- All amendments must include migration plan for existing code

### Compliance & Review

- All pull requests must include constitution compliance checklist
- Quarterly reviews to assess adherence and identify gaps
- New team members must acknowledge constitution within first week
- Violations must be addressed before next release cycle

### Living Agreement

The team treats this constitution as a living agreement: updated as we grow, enforced with empathy, and grounded in the
principle that technical excellence enables creative freedom. Regular retrospectives will evaluate if principles still
serve the team and users effectively.

**Version**: 1.0.0 | **Ratified**: 2025-10-28 | **Last Amended**: 2025-10-28
