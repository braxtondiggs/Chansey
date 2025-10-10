<!--
Sync Impact Report:
- Version change: 1.0.2 → 1.1.0
- Modified principles: Testing Standards (removed E2E testing requirement)
- Added sections: None
- Removed sections: E2E Tests requirement from Testing Standards
- Templates requiring updates:
  ⚠️ plan-template.md (needs alignment - remove E2E test gates)
  ⚠️ tasks-template.md (needs alignment - remove E2E test tasks)
- Follow-up TODOs: Update plan and task templates to remove E2E testing references
-->

# Chansey Constitution

## Core Principles

### I. Code Quality

Code MUST be maintainable, readable, and follow established conventions:

- **Import Order**: Angular → NestJS → third-party → internal → relative (enforced by ESLint)
- **Formatting**: Prettier with 120-character line length (automated via pre-commit hooks)
- **Linting**: ESLint rules MUST pass before commits (no warnings or errors)
- **Type Safety**: TypeScript strict mode enabled; no `any` types without explicit justification
- **Documentation**: Public APIs and complex logic MUST include JSDoc comments
- **Code Review**: All changes require PR review before merging

**Rationale**: Consistent code quality reduces technical debt, improves onboarding, and prevents production issues. The monorepo structure demands strict conventions to maintain clarity across frontend and backend codebases.

### II. Testing Standards

Test-Driven Development principles with comprehensive coverage:

- **Unit Tests**: Jest for business logic, services, and utilities (target 80%+ coverage)
- **Integration Tests**: API endpoints MUST have integration tests verifying request/response contracts
- **Contract Testing**: External API integrations (CCXT, CoinGecko) MUST have contract tests
- **Test Execution**: All tests MUST pass in CI before merging
- **Test Maintenance**: Tests are first-class code; outdated tests MUST be updated or removed

**Rationale**: Financial applications handling cryptocurrency transactions require rigorous testing. Integration tests catch issues with exchange APIs and background job processing that unit tests cannot detect. Unit tests with comprehensive mocking provide sufficient coverage for UI components.

### III. User Experience Consistency

Deliver a cohesive, accessible, and responsive user interface:

- **Component Library**: PrimeNG components MUST be used for consistency; custom components require design review
- **Responsive Design**: Mobile-first approach; all features MUST work on mobile devices
- **Accessibility**: WCAG 2.1 AA compliance for all user-facing features
- **Loading States**: Async operations MUST show loading indicators via TanStack Query patterns
- **Error Handling**: User-friendly error messages; technical details logged server-side only
- **Performance**: First Contentful Paint <2s, Time to Interactive <3.5s on 3G networks

**Rationale**: Portfolio management requires rapid decision-making. Consistent UX reduces cognitive load, while accessibility and mobile support expand the user base. PWA capabilities enable offline portfolio viewing.

### IV. Architectural Consistency

Maintain clear separation of concerns across the Nx monorepo:

- **Monorepo Structure**: Apps (api, chansey) contain application logic; libs contain shared interfaces only
- **Frontend Architecture**: Standalone Angular components; TanStack Query for state management; no NgModules
- **Backend Architecture**: NestJS modules organized by domain (users, exchanges, orders, portfolios); TypeORM entities co-located with modules
- **API Design**: RESTful conventions; Swagger/OpenAPI documentation auto-generated from decorators
- **Background Jobs**: BullMQ queues for async tasks (order sync, price updates); queue processors co-located with domain logic
- **Database Migrations**: TypeORM migrations for schema changes; no direct schema modifications
- **Shared Code**: api-interfaces lib ONLY for TypeScript types shared between frontend and backend
- **Trading Execution Model**: Algorithm-based trading is backend-driven with automatic algorithm selection; the backend automatically activates/deactivates algorithms based on performance metrics and user risk preferences. Users control behavior ONLY through risk preference settings (conservative/moderate/aggressive)—they cannot manually activate/deactivate specific algorithms or modify trading signals. Frontend serves as a monitoring interface displaying active algorithms and performance reasoning. Users CAN execute manual trades separately from automated trading. All algorithmic trading logic and activation decisions reside in backend services and BullMQ processors.

**Brownfield Rules**:

- **No Scaffolding**: Do NOT scaffold new apps, modules, or ORM models from scratch
- **Existing Structure**: Integrate with the existing Nx monorepo layout (apps/api for backend, apps/chansey for frontend)
- **Entity Location**: Backend entities live in libs/database/entities; database configured via TypeORM module
- **Extension Only**: Only extend existing services/controllers; keep imports and providers intact
- **Schema Changes**: Any schema change MUST produce a TypeORM migration against the existing PostgreSQL database

**Rationale**: The Nx monorepo enables code sharing but demands discipline. Domain-driven design in the backend and component-based architecture in the frontend prevent coupling. Background job isolation ensures resilience for critical financial data synchronization. Backend-driven trading execution ensures regulatory compliance, consistent strategy implementation, and prevents user error during time-sensitive market operations. Brownfield constraints prevent breaking the established architecture and ensure all changes integrate smoothly with existing infrastructure.

### V. Performance Requirements

Ensure scalability and responsiveness for real-time financial data:

- **API Response Time**: <200ms p95 for CRUD operations; <500ms for complex aggregations
- **Background Job Efficiency**: Order sync MUST process 100+ orders/second per exchange
- **Database Queries**: Queries MUST use indexes; N+1 queries are prohibited
- **Caching Strategy**: Redis caching for exchange rate data (5-minute TTL) and user sessions
- **Frontend Performance**: Bundle size <500KB gzipped; code splitting by route
- **Rate Limiting**: API rate limits enforced (100 req/min standard, 20 req/min for auth/uploads)
- **Monitoring**: Response times and error rates MUST be observable via logs and metrics

**Rationale**: Cryptocurrency markets operate 24/7 with rapid price changes. Slow portfolio updates or API timeouts erode user trust. Background job efficiency ensures timely order synchronization across multiple exchanges without overwhelming external APIs.

## Development Standards

### Workflow Requirements

- **Git Branching**: Feature branches from `master`; descriptive branch names (e.g., `feat/portfolio-chart-improvements`)
- **Commit Messages**: Conventional Commits format (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`)
- **Pre-commit Hooks**: Linting and formatting automated via Husky and lint-staged
- **Pull Requests**: Include description, testing notes, and screenshots for UI changes
- **Dependency Management**: Security vulnerabilities MUST be addressed within 7 days of disclosure

### Security Requirements

- **Authentication**: JWT with refresh tokens; HttpOnly cookies for token storage
- **Authorization**: Role-based access control (admin/user) enforced at API layer
- **API Key Storage**: Exchange API keys encrypted at rest using industry-standard algorithms
- **Input Validation**: class-validator decorators on all DTOs; sanitize user input
- **Security Headers**: Helmet middleware for CSRF, XSS, and clickjacking protection
- **Secrets Management**: No secrets in code; environment variables for all credentials

## Governance

This constitution establishes the non-negotiable standards for Chansey development. All contributors MUST adhere to these principles.

### Amendment Process

1. Proposed amendments MUST be documented in a GitHub issue with rationale
2. Team consensus required (majority vote for MINOR changes, unanimous for MAJOR changes)
3. Constitution version MUST be incremented using semantic versioning:
   - **MAJOR**: Backward-incompatible principle removals or redefinitions
   - **MINOR**: New principles or materially expanded guidance
   - **PATCH**: Clarifications, wording fixes, non-semantic refinements
4. All dependent templates (plan, spec, tasks) MUST be updated to reflect amendments

### Compliance Review

- PRs violating constitutional principles MUST be rejected or amended
- Complexity that deviates from principles MUST be explicitly justified in implementation plans
- Constitution compliance is verified during code review and retrospectives

### Living Document

This constitution evolves with the project. Consult `CLAUDE.md` at repository root for runtime development guidance and common commands.

**Version**: 1.1.0 | **Ratified**: 2025-09-30 | **Last Amended**: 2025-10-09
