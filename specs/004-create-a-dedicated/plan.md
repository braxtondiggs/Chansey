# Implementation Plan: Cryptocurrency Detail Page

**Branch**: `004-create-a-dedicated` | **Date**: 2025-10-22 | **Spec**: [spec.md](./spec.md) **Input**: Feature
specification from `/specs/004-create-a-dedicated/spec.md`

## Execution Flow (/plan command scope)

```
1. Load feature spec from Input path
   → If not found: ERROR "No feature spec at {path}"
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
   → Detect Project Type from file system structure or context (web=frontend+backend, mobile=app+api)
   → Set Structure Decision based on project type
3. Fill the Constitution Check section based on the content of the constitution document.
4. Evaluate Constitution Check section below
   → If violations exist: Document in Complexity Tracking
   → If no justification possible: ERROR "Simplify approach first"
   → Update Progress Tracking: Initial Constitution Check
5. Execute Phase 0 → research.md
   → If NEEDS CLARIFICATION remain: ERROR "Resolve unknowns"
6. Execute Phase 1 → contracts, data-model.md, quickstart.md, agent-specific template file (e.g., `CLAUDE.md` for Claude Code, `.github/copilot-instructions.md` for GitHub Copilot, `GEMINI.md` for Gemini CLI, `QWEN.md` for Qwen Code or `AGENTS.md` for opencode).
7. Re-evaluate Constitution Check section
   → If new violations: Refactor design, return to Phase 1
   → Update Progress Tracking: Post-Design Constitution Check
8. Plan Phase 2 → Describe task generation approach (DO NOT create tasks.md)
9. STOP - Ready for /tasks command
```

**IMPORTANT**: The /plan command STOPS at step 7. Phases 2-4 are executed by other commands:

- Phase 2: /tasks command creates tasks.md
- Phase 3-4: Implementation execution (manual or via tools)

## Brownfield Context

**IMPORTANT**: This is a BROWNFIELD feature. Respect existing modules and DB schema.

- **Project Layout**: Nx monorepo; NestJS API at `apps/api`; entities in `libs/database/entities`
- **No Scaffolding**: Do not generate new ORM models; only modify/extend existing services/controllers
- **Stability**: Verify imports/providers remain stable; reference concrete file paths when proposing edits
- **Output Format**: Diffs/edits to existing files, NOT scaffolding new structures

## Summary

Create a dedicated detail page for cryptocurrencies that displays comprehensive market information and user holdings.
When users click on a coin from the list, they navigate to `/coins/{coin-slug}` where they see public market data
(price, charts, statistics, description, external links) combined with their personal holdings from connected exchanges
(authenticated users only). The page automatically refreshes price data every 30-60 seconds and supports four time
period views (24h, 7d, 30d, 1y) for price history charts. This hybrid approach provides both universal market context
and personalized portfolio insights in a single view.

## Technical Context

**Language/Version**: TypeScript 5.x (Angular 20 frontend, NestJS 10 backend) **Primary Dependencies**: Angular 20
standalone components, PrimeNG UI library, TanStack Query, NestJS, TypeORM, CoinGecko API (public market data), CCXT
(exchange integration) **Storage**: PostgreSQL (existing Coin entity in libs/database/entities), Redis (caching for
market data) **Testing**: Jest (unit/integration), Cypress (E2E - removed per constitution v1.1.0) **Target Platform**:
Web application (responsive, mobile-first, PWA-enabled) **Project Type**: web (Nx monorepo with separate
frontend/backend) **Performance Goals**: API <200ms p95 for coin detail endpoint, frontend FCP <2s, TTI <3.5s on 3G
**Constraints**: Price refresh every 30-60s, CoinGecko API rate limits (50 calls/min free tier), bundle size <500KB
gzipped **Scale/Scope**: ~200 tracked coins, 10k users, single detail page component with 5-6 sub-sections

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Verify alignment with `.specify/memory/constitution.md`:

### Code Quality Gates

- [x] ESLint and Prettier configurations will be followed (pre-commit hooks enforce)
- [x] TypeScript strict mode enabled; no unjustified `any` types (strict mode in tsconfig)
- [x] Public API and complex logic will include JSDoc comments (API service methods, query hooks)

### Testing Standards Gates

- [x] Unit tests planned for business logic (Jest, 80%+ coverage target) - service layer, utilities
- [x] Integration tests planned for API endpoints - GET /api/coins/:slug endpoint
- [x] Contract tests planned for external API integrations - CoinGecko API responses
- Note: E2E tests removed per constitution v1.1.0

### User Experience Gates

- [x] PrimeNG components used for consistency (Card, Chart, Skeleton, Button, TabView)
- [x] Mobile-first responsive design approach (TailwindCSS responsive classes)
- [x] WCAG 2.1 AA accessibility compliance planned (semantic HTML, ARIA labels, keyboard navigation)
- [x] Loading states and error handling patterns defined (TanStack Query loading/error states, skeleton screens)

### Architectural Consistency Gates

- [x] Follows Nx monorepo structure (apps vs libs separation) - apps/chansey frontend, apps/api backend
- [x] Backend: NestJS domain modules with co-located TypeORM entities - extend existing coin module
- [x] Frontend: Standalone Angular components with TanStack Query - standalone CoinDetailComponent
- [x] Background jobs: BullMQ queues co-located with domain logic - reuse existing price update job
- [x] Database changes: TypeORM migrations only - extend existing Coin entity if needed

### Performance Requirements Gates

- [x] API response time targets defined (<200ms p95 for CRUD) - GET /api/coins/:slug target <150ms
- [x] Database queries will use indexes (no N+1 queries) - single query with joins for coin+holdings
- [x] Caching strategy identified (Redis where appropriate) - Redis cache for CoinGecko data (5min TTL)
- [x] Frontend bundle size considerations (<500KB gzipped) - lazy-loaded route, chart lib code-split
- [x] Rate limiting patterns defined - existing rate limiter applies (100 req/min)

## Project Structure

### Documentation (this feature)

```
specs/[###-feature]/
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output (/plan command)
├── data-model.md        # Phase 1 output (/plan command)
├── quickstart.md        # Phase 1 output (/plan command)
├── contracts/           # Phase 1 output (/plan command)
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (repository root)

```
apps/
├── api/
│   └── src/
│       ├── coin/                          # Existing coin module - EXTEND
│       │   ├── coin.controller.ts         # Add GET /coins/:slug endpoint
│       │   ├── coin.service.ts            # Add getCoinBySlug, getMarketData methods
│       │   └── coin.controller.spec.ts    # Add integration tests
│       └── order/                         # Existing order module - READ ONLY
│           └── order.service.ts           # Query user orders for holdings calc
│
├── chansey/
│   └── src/
│       ├── app/
│       │   ├── coins/                     # NEW: Coin feature module
│       │   │   ├── coin-detail/           # NEW: Detail page component
│       │   │   │   ├── coin-detail.component.ts
│       │   │   │   ├── coin-detail.component.html
│       │   │   │   ├── coin-detail.component.scss
│       │   │   │   └── coin-detail.component.spec.ts
│       │   │   ├── components/            # NEW: Sub-components
│       │   │   │   ├── price-chart/       # Chart with time period selector
│       │   │   │   ├── market-stats/      # Stats cards
│       │   │   │   ├── holdings-card/     # User holdings display
│       │   │   │   └── external-links/    # Links section
│       │   │   └── services/              # NEW: Query hooks
│       │   │       └── coin-detail.queries.ts  # TanStack Query hooks
│       │   └── app.routes.ts              # Add /coins/:slug route
│       └── environments/
│
└── libs/
    ├── api-interfaces/                    # Shared types - EXTEND
    │   └── src/
    │       └── lib/
    │           └── coin.interface.ts      # Add CoinDetail, MarketData DTOs
    └── database/
        └── entities/                      # Existing entities - EXTEND IF NEEDED
            └── coin.entity.ts             # Verify fields for slug, description, links

tests/
└── contract/                              # NEW: Contract tests
    └── coingecko-api.contract.spec.ts     # CoinGecko response validation
```

**Structure Decision**: Web application (Nx monorepo). Frontend in `apps/chansey` uses standalone Angular components
with lazy-loaded routing. Backend in `apps/api` extends existing coin module with new detail endpoint. Shared types in
`libs/api-interfaces`. No new ORM entities needed - reuse existing Coin entity from `libs/database/entities`.

## Phase 0: Outline & Research

1. **Extract unknowns from Technical Context** above:
   - For each NEEDS CLARIFICATION → research task
   - For each dependency → best practices task
   - For each integration → patterns task

2. **Generate and dispatch research agents**:

   ```
   For each unknown in Technical Context:
     Task: "Research {unknown} for {feature context}"
   For each technology choice:
     Task: "Find best practices for {tech} in {domain}"
   ```

3. **Consolidate findings** in `research.md` using format:
   - Decision: [what was chosen]
   - Rationale: [why chosen]
   - Alternatives considered: [what else evaluated]

**Output**: research.md with all NEEDS CLARIFICATION resolved

## Phase 1: Design & Contracts

_Prerequisites: research.md complete_

1. **Extract entities from feature spec** → `data-model.md`:
   - Entity name, fields, relationships
   - Validation rules from requirements
   - State transitions if applicable

2. **Generate API contracts** from functional requirements:
   - For each user action → endpoint
   - Use standard REST/GraphQL patterns
   - Output OpenAPI/GraphQL schema to `/contracts/`

3. **Generate contract tests** from contracts:
   - One test file per endpoint
   - Assert request/response schemas
   - Tests must fail (no implementation yet)

4. **Extract test scenarios** from user stories:
   - Each story → integration test scenario
   - Quickstart test = story validation steps

5. **Update agent file incrementally** (O(1) operation):
   - Run `.specify/scripts/bash/update-agent-context.sh claude` **IMPORTANT**: Execute it exactly as specified above. Do
     not add or remove any arguments.
   - If exists: Add only NEW tech from current plan
   - Preserve manual additions between markers
   - Update recent changes (keep last 3)
   - Keep under 150 lines for token efficiency
   - Output to repository root

**Output**: data-model.md, /contracts/\*, failing tests, quickstart.md, agent-specific file

## Phase 2: Task Planning Approach

_This section describes what the /tasks command will do - DO NOT execute during /plan_

**Task Generation Strategy**:

- Load `.specify/templates/tasks-template.md` as base
- Generate tasks from Phase 1 design docs (contracts, data model, quickstart)
- Each contract → contract test task [P]
- Each entity → model creation task [P]
- Each user story → integration test task
- Implementation tasks to make tests pass

**Ordering Strategy**:

- TDD order: Tests before implementation
- Dependency order: Models before services before UI
- Mark [P] for parallel execution (independent files)

**Estimated Output**: 25-30 numbered, ordered tasks in tasks.md

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation

_These phases are beyond the scope of the /plan command_

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking

_Fill ONLY if Constitution Check has violations that must be justified_

| Violation                  | Why Needed         | Simpler Alternative Rejected Because |
| -------------------------- | ------------------ | ------------------------------------ |
| [e.g., 4th project]        | [current need]     | [why 3 projects insufficient]        |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient]  |

## Progress Tracking

_This checklist is updated during execution flow_

**Phase Status**:

- [x] Phase 0: Research complete (/plan command) - research.md created
- [x] Phase 1: Design complete (/plan command) - data-model.md, contracts/, quickstart.md, CLAUDE.md updated
- [x] Phase 2: Task planning complete (/plan command - describe approach only) - see Phase 2 section
- [x] Phase 3: Tasks generated (/tasks command) - tasks.md created with 44 tasks
- [ ] Phase 4: Implementation complete - Ready to execute tasks
- [ ] Phase 5: Validation passed

**Gate Status**:

- [x] Initial Constitution Check: PASS - All gates satisfied
- [x] Post-Design Constitution Check: PASS - Design aligns with constitution
- [x] All NEEDS CLARIFICATION resolved - Research phase addressed all unknowns
- [x] Complexity deviations documented - No violations, no complexity tracking needed

**Artifacts Generated**:
- `/specs/004-create-a-dedicated/research.md` - Technical decisions and rationale
- `/specs/004-create-a-dedicated/data-model.md` - Entity modifications, DTOs, query patterns
- `/specs/004-create-a-dedicated/contracts/coin-detail-api.yaml` - OpenAPI 3.0 contract
- `/specs/004-create-a-dedicated/quickstart.md` - 12 manual test scenarios
- `/specs/004-create-a-dedicated/tasks.md` - 44 ordered tasks with TDD workflow
- `/CLAUDE.md` - Updated with TypeScript 5.x + Angular 20 context

---

_Based on Constitution v1.1.0 - See `.specify/memory/constitution.md`_
