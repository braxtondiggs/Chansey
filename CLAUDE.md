# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Basic Commands

- `npm run api` - Start the NestJS API server (apps/api)
- `npm run site` - Start the Angular frontend (apps/chansey)
- `npm start` - Start both API and frontend in parallel
- `npm run build` - Build all applications
- `npm run test` - Run all tests across the workspace
- `npm run lint` - Run ESLint on all projects
- `npm run e2e` - Run end-to-end tests with Cypress

### Nx-Specific Commands

- `nx serve api` - Serve API application
- `nx serve chansey` - Serve Angular frontend
- `nx build api` - Build API specifically
- `nx build chansey` - Build frontend specifically
- `nx affected:test` - Run tests only for affected projects
- `nx affected:lint` - Run linting only for affected projects
- `nx dep-graph` - View project dependency graph

### Code Quality

- `npm run format` - Format code with Prettier
- `npm run format:check` - Check code formatting
- `npm run format:tailwind` - Format HTML files with Tailwind CSS class ordering

## Architecture Overview

### Monorepo Structure

This is an Nx monorepo with Angular frontend and NestJS API backend:

- **apps/api** - NestJS API server with TypeORM database integration
- **apps/chansey** - Angular 21 frontend with PrimeNG UI components
- **apps/chansey-e2e** - Cypress end-to-end tests
- **libs/api-interfaces** - Shared TypeScript interfaces between API and frontend

### Key Technologies

- **Backend**: NestJS, TypeORM, PostgreSQL, Redis, BullMQ (job queues)
- **Frontend**: Angular 21, PrimeNG, TailwindCSS, PWA support
- **External APIs**: CCXT (cryptocurrency exchanges), CoinGecko
- **Infrastructure**: Railway deployment, Minio (file storage)

### Core Domain

- Cryptocurrency exchange integration (Binance, Coinbase) via CCXT with encrypted API keys
- BullMQ background jobs for order sync, price updates, balance tracking, and algo trading pipeline
- Module-specific details are in `.claude/rules/` files (loaded automatically by path)

### Frontend Architecture

- Standalone Angular components (not NgModules)
- TanStack Query for state management and caching
- PrimeNG component library with custom theming
- Responsive design with mobile-first approach
- PWA capabilities with service worker

## Development Workflow

### Code Style

- ESLint configuration enforces import ordering and Angular conventions
- Prettier for consistent code formatting with 120 character line length
- Pre-commit hooks automatically fix linting issues and format code
- Import order: Angular → NestJS → third-party → internal → relative
- **Lint warnings are NOT acceptable for the chansey (frontend) project** — all warnings must be resolved before
  committing
- **Fix lint errors and warnings in files you change** — when modifying a file, resolve any lint warnings in that file
  before committing, even pre-existing ones. Do not introduce or leave warnings in touched files.

### File Size Limits

- **Backend** (services, strategies, tasks, entities): Soft limit **500 lines**, hard limit **750 lines**
- **Frontend** (components): Soft limit **250 lines**, hard limit **400 lines**
- **Frontend** (services): Soft limit **300 lines**, hard limit **450 lines**
- At the soft limit, consider extracting responsibilities into focused services or components. At the hard limit,
  refactoring is required before adding more logic.
- When creating new functionality, prefer adding a new focused service/component over expanding an existing one.

### Testing

- Jest for unit tests
- Cypress for e2e tests
- **Run a single test file**: `npx nx test api -- --testPathPattern='confluence.strategy.spec'`
  - The `--` separator is required to pass args through to Jest (test target uses `nx:run-commands`)
  - Do NOT use `--testFile` — it is not a valid Jest flag and gets silently ignored
- API endpoints documented with Bruno collection in `docs/bruno/`

### Database & Migrations

- TypeORM with PostgreSQL
- Migration files in `apps/api/src/migrations/`
- Entities use decorators for database mapping
- **NEVER use `uuid_generate_v4()`** in migrations — it requires the `uuid-ossp` extension which is not available.
  **Always use `gen_random_uuid()`** instead (built into PostgreSQL 13+ natively)
- **Migration timestamps must be chronologically ordered.** Use `Date.now()` (13-digit Unix epoch in ms) when creating
  migrations. Never use a timestamp older than the latest existing migration file. Check `ls apps/api/src/migrations/`
  to find the latest timestamp before naming your file.

### Queue Management

- BullMQ dashboard available at `/api/admin/queues` (admin only)
- Background jobs organized by domain (orders, prices, balances, etc.)

### API Documentation

- Swagger/OpenAPI documentation available when running API
- Bruno collection provides comprehensive API testing examples

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

## General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects,
  targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e.
  `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using
  globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed
  without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST
  before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

## Active Technologies

- TypeScript 5.x with Node.js 22+ + NestJS 11, TypeORM 0.3, BullMQ, PostgreSQL 15+, Redis, TanStack Query (frontend)
  (005-auto-backtest-orchestration)
- PostgreSQL for persistent data (strategies, audit logs), Redis for caching and job queues, 5-year retention for audit
  data (005-auto-backtest-orchestration)

## Recent Changes

- 005-auto-backtest-orchestration: Added TypeScript 5.x with Node.js 22+ + NestJS 11, TypeORM 0.3, BullMQ, PostgreSQL
  15+, Redis, TanStack Query (frontend)

## Design Context

### Users

Beginners exploring cryptocurrency trading. New to crypto, need guidance, simplicity, and reassurance. Looking for a
low-friction way to start investing without feeling overwhelmed. The interface should make them feel safe, informed, and
in control.

### Brand Personality

**Modern, approachable, empowering.** Cymbit Trading sits in the Acorns-for-crypto space — making cryptocurrency
investing feel as natural and low-stress as saving spare change. Friendly and encouraging without being patronizing.

### Aesthetic Direction

- **Visual tone**: Clean, warm, approachable — inspired by Acorns and Coinbase/Robinhood. Generous whitespace, rounded
  forms, clear hierarchy. Premium but not cold.
- **References**: Acorns (simplicity, guided investing), Coinbase (clean crypto UI), Robinhood (accessible finance)
- **Anti-references**: NOT Binance/KuCoin (cluttered). NOT generic corporate SaaS. NOT intimidating.
- **Theme**: User-configurable. Three PrimeNG presets (Aura, Lara, Nora) with full primary/surface color control. Design
  must work across all combinations and both light/dark modes.
- **Typography**: InterDisplay (headings), Lato (body). Full weight range (100-900).

### Design Principles

1. **Simplicity over density** — Breathable screens. Progressive disclosure over showing everything at once.
2. **Guide, don't gate** — Clear labels, tooltips, contextual education. Teach as it goes without blocking.
3. **Theme-resilient design** — Must look excellent across all presets, colors, and modes. Use design tokens only.
4. **Confidence through clarity** — Consistent patterns, predictable interactions, clear feedback for financial trust.
5. **Mobile-first, PWA-ready** — Phone-first user. Touch targets, responsive layouts, offline-capable patterns.
