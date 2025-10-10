# Implementation Plan: Complete Crypto Trading UI Enhancement

**Branch**: `003-order-type-fields` | **Date**: 2025-10-09 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/Users/braxtondiggs/Sites/Chansey/specs/003-order-type-fields/spec.md`

## Execution Flow (/plan command scope)
```
1. Load feature spec from Input path
   → Loaded: 45 functional requirements across 10 feature areas
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
   → Detected Project Type: web (Angular frontend + NestJS backend)
   → Set Structure Decision: Nx monorepo with standalone Angular components
3. Fill the Constitution Check section based on constitution document
   → All gates evaluated against constitution v1.0.2
4. Evaluate Constitution Check section
   → No violations detected - template-only changes
   → Update Progress Tracking: Initial Constitution Check ✓
5. Execute Phase 0 → research.md
   → PrimeNG component patterns researched
   → TanStack Query patterns for real-time updates researched
   → Angular form validation best practices documented
6. Execute Phase 1 → contracts, data-model.md, quickstart.md, CLAUDE.md
   → No new API contracts needed (using existing endpoints)
   → Data model documented (existing entities, no schema changes)
   → Quickstart scenarios for all 10 UI features
   → CLAUDE.md updated with UI enhancement patterns
7. Re-evaluate Constitution Check section
   → No new violations - UI-only enhancement
   → Update Progress Tracking: Post-Design Constitution Check ✓
8. Plan Phase 2 → Describe task generation approach
   → Template enhancement tasks organized by UI section
9. STOP - Ready for /tasks command ✓
```

**IMPORTANT**: The /plan command STOPS at step 9. Phases 2-4 are executed by other commands:
- Phase 2: /tasks command creates tasks.md
- Phase 3-4: Implementation execution (manual or via tools)

## Brownfield Context
**IMPORTANT**: This is a BROWNFIELD feature. Respect existing modules and DB schema.

- **Project Layout**: Nx monorepo; Angular app at `apps/chansey`; existing crypto-trading component at `apps/chansey/src/app/shared/components/crypto-trading/`
- **No Scaffolding**: Component already exists with all helper methods and state management; only enhance template
- **Stability**: Component TypeScript file has all required methods (shouldShowPriceField(), getStatusClass(), etc.); only add template markup
- **Output Format**: Template additions to existing crypto-trading.component.html file, NO backend changes

## Summary
Enhance the existing crypto-trading component template to expose all functionality already implemented in the TypeScript component. The component has complete validation logic, order preview signals, order book queries, and helper methods - but the template doesn't display these features. This is purely a template enhancement to surface existing functionality through the UI using PrimeNG components. No backend changes, no new API endpoints, no database migrations required.

## Technical Context
**Language/Version**: TypeScript 5.x, Angular 19
**Primary Dependencies**: PrimeNG 19, TanStack Query (Angular Query), RxJS 7
**Storage**: N/A (frontend display only, using existing backend APIs)
**Testing**: Jasmine/Karma for unit tests, Cypress for E2E tests
**Target Platform**: Web browsers (Chrome, Firefox, Safari, Edge - latest 2 versions)
**Project Type**: web (Angular standalone components + NestJS API)
**Performance Goals**: FCP <1.5s, TTI <2.5s, component re-renders <16ms
**Constraints**: <500KB bundle size per route, WCAG 2.1 AA compliance, mobile-first responsive
**Scale/Scope**: Single component enhancement (~500 lines template code), 10 UI features, ~15-20 PrimeNG components

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Verify alignment with `.specify/memory/constitution.md`:

### Code Quality Gates
- [x] ESLint and Prettier configurations will be followed
- [x] TypeScript strict mode enabled; no unjustified `any` types (no TypeScript changes)
- [x] Public API and complex logic will include JSDoc comments (template only, no new methods)

### Testing Standards Gates
- [x] Unit tests planned for business logic (existing methods tested, template additions via E2E)
- [x] Integration tests planned for API endpoints (using existing endpoints, no new integration tests)
- [x] E2E tests planned for critical user flows (Cypress tests for order placement, preview, cancellation)
- [x] Contract tests planned for external API integrations (N/A - frontend only)

### User Experience Gates
- [x] PrimeNG components used for consistency (InputNumber, Select, Button, Table, SelectButton, Message, Card)
- [x] Mobile-first responsive design approach (PrimeNG grid system with responsive breakpoints)
- [x] WCAG 2.1 AA accessibility compliance planned (aria-labels, keyboard navigation, error announcements)
- [x] Loading states and error handling patterns defined (TanStack Query isPending, error states)

### Architectural Consistency Gates
- [x] Follows Nx monorepo structure (apps vs libs separation) (template changes in apps/chansey)
- [x] Backend: NestJS domain modules with co-located TypeORM entities (N/A - no backend changes)
- [x] Frontend: Standalone Angular components with TanStack Query (existing component already uses this pattern)
- [x] Background jobs: BullMQ queues co-located with domain logic (N/A - frontend only)
- [x] Database changes: TypeORM migrations only (N/A - no database changes)

### Performance Requirements Gates
- [x] API response time targets defined (using existing endpoints, no changes to API performance)
- [x] Database queries will use indexes (N/A - no database changes)
- [x] Caching strategy identified (TanStack Query already caching with staleTime/cacheTime)
- [x] Frontend bundle size considerations (template only, minimal impact <5KB gzipped)
- [x] Rate limiting patterns defined (existing API rate limits apply)

## Project Structure

### Documentation (this feature)
```
specs/003-order-type-fields/
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output (/plan command)
├── data-model.md        # Phase 1 output (/plan command)
├── quickstart.md        # Phase 1 output (/plan command)
├── contracts/           # Phase 1 output (empty - no new contracts)
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (repository root)
```
apps/chansey/src/app/shared/components/crypto-trading/
├── crypto-trading.component.ts         # EXISTING - no changes needed
├── crypto-trading.component.html       # MODIFIED - add missing UI elements
└── crypto-trading.component.spec.ts    # EXISTING - may add template tests

apps/chansey-e2e/src/e2e/
├── crypto-trading.cy.ts                # NEW - E2E tests for enhanced UI

libs/api-interfaces/src/lib/
└── [existing interfaces]               # EXISTING - no changes needed
```

**Structure Decision**: Single component template enhancement in the existing Nx monorepo Angular application. No backend changes, no new files except E2E tests. All functionality already exists in the TypeScript component - we're only updating the HTML template to display it.

## Phase 0: Outline & Research
1. **Extract unknowns from Technical Context** above:
   - **PrimeNG Component Patterns**: Research best practices for PrimeNG InputNumber, Select, SelectButton, Table, and Message components
   - **Conditional Template Display**: Research Angular *ngIf patterns for dynamic form field visibility
   - **Form Validation Feedback**: Research PrimeNG validation message patterns with p-error class
   - **Real-time Preview Updates**: Research TanStack Query signal integration with Angular templates
   - **Order Book Display**: Research PrimeNG Table with click-to-fill pattern for bid/ask prices
   - **Accessibility Patterns**: Research WCAG 2.1 AA compliance for trading interfaces

2. **Generate and dispatch research agents**: N/A (using established patterns from codebase)

3. **Consolidate findings** in `research.md` using format:
   - Decision: PrimeNG components for all UI elements
   - Rationale: Consistency with existing codebase, mobile-first responsive
   - Alternatives considered: Custom components (rejected for consistency)

**Output**: research.md with UI component pattern decisions

## Phase 1: Design & Contracts
*Prerequisites: research.md complete*

1. **Extract entities from feature spec** → `data-model.md`:
   - **Order**: Existing entity, no changes
   - **OrderPreview**: Existing DTO, displayed in template
   - **TradingPair**: Existing entity, no changes
   - **ExchangeBalance**: Existing entity, no changes
   - **OrderBook**: Existing entity, no changes
   - **UI State**: Component signals (already exist)

2. **Generate API contracts** from functional requirements:
   - No new API endpoints needed
   - Using existing endpoints: GET /order, POST /order/manual/preview, POST /order/manual, DELETE /order/:id
   - Contracts already defined in order.controller.ts

3. **Generate contract tests** from contracts:
   - N/A - using existing API endpoints
   - Backend contract tests already exist in order.controller.spec.ts

4. **Extract test scenarios** from user stories:
   - Order type field visibility tests
   - Order preview display tests
   - Active orders table tests
   - Market price display tests
   - Validation feedback tests
   - Submit button state tests
   - Exchange selection tests
   - Balance display tests
   - Percentage button tests
   - Order book interaction tests

5. **Update agent file incrementally** (O(1) operation):
   - Run `.specify/scripts/bash/update-agent-context.sh claude`
   - Add UI enhancement patterns for crypto trading
   - Document PrimeNG component usage patterns
   - Update recent changes with template enhancements

**Output**: data-model.md, quickstart.md, CLAUDE.md update, E2E test scenarios

## Phase 2: Task Planning Approach
*This section describes what the /tasks command will do - DO NOT execute during /plan*

**Task Generation Strategy**:
- Group tasks by UI feature area (10 feature groups from spec)
- Each feature → template modification task + E2E test task
- Order tasks by dependency (Exchange selection → Market price → Order type fields → Preview → Submit)
- Mark [P] for independent sections that can be coded in parallel

**Task Ordering**:
1. **Exchange Selection UI** [P] - Message when no exchange + disable state
2. **Market Price Display** [P] - Current price + 24h change with styling
3. **Order Type Field Visibility** - Conditional *ngIf directives for all order types
4. **Balance Display** [P] - Available balances + remaining after trade
5. **Percentage Quick Select Buttons** - SelectButton for 25/50/75/Max
6. **Order Preview Display** - Cost, fees, total, balance check, warnings
7. **Validation Feedback** - Error messages below fields with p-error
8. **Submit Button States** - Disabled states + loading indicators
9. **Active Orders Table** - Full table with all columns + cancel buttons
10. **Order Book Display** - Bid/ask table with click-to-fill
11. **E2E Test Suite** - Cypress tests for all 10 features
12. **Accessibility Audit** - WCAG 2.1 AA compliance verification

**Estimated Output**: 15-18 numbered, ordered tasks in tasks.md (10 template sections + tests + audit)

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)
**Phase 4**: Implementation (execute tasks.md following constitutional principles)
**Phase 5**: Validation (run E2E tests, accessibility audit, performance validation)

## Complexity Tracking
*Fill ONLY if Constitution Check has violations that must be justified*

No violations detected - this is a template-only enhancement to an existing component.

## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command)
- [x] Phase 1: Design complete (/plan command)
- [x] Phase 2: Task planning complete (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved (none existed)
- [x] Complexity deviations documented (none)

---
*Based on Constitution v1.0.2 - See `.specify/memory/constitution.md`*
