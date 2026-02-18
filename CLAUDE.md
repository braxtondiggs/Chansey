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
- **apps/chansey** - Angular 20 frontend with PrimeNG UI components
- **apps/chansey-e2e** - Cypress end-to-end tests
- **libs/api-interfaces** - Shared TypeScript interfaces between API and frontend

### Key Technologies

- **Backend**: NestJS, TypeORM, PostgreSQL, Redis, BullMQ (job queues)
- **Frontend**: Angular 20, PrimeNG, TailwindCSS, PWA support
- **External APIs**: CCXT (cryptocurrency exchanges), CoinGecko
- **Infrastructure**: Railway deployment, Minio (file storage)

### Core Business Logic

#### Exchange Integration

- Supports multiple cryptocurrency exchanges (Binance, Coinbase)
- Uses CCXT library for standardized exchange API interactions
- Exchange keys stored securely with user authentication
- Automated order synchronization via scheduled tasks

#### Key Entities

- **Users**: Authentication with JWT, role-based access
- **Exchanges**: Cryptocurrency exchange configurations
- **Exchange Keys**: User's encrypted API keys for exchanges
- **Orders**: Trading orders synced from exchanges
- **Portfolios**: User investment portfolios
- **Coins**: Cryptocurrency information with price tracking
- **Categories**: Asset categorization system
- **Algorithms**: Trading algorithm configurations

#### Background Processing

- Uses BullMQ for job queues with Redis backend
- Scheduled tasks for data synchronization:
  - Order sync (hourly)
  - Price updates
  - Balance calculations
  - Portfolio historical data

### Frontend Architecture

- Standalone Angular components (not NgModules)
- TanStack Query for state management and caching
- PrimeNG component library with custom theming
- Responsive design with mobile-first approach
- PWA capabilities with service worker

### Authentication & Security

- JWT-based authentication with refresh token implementation
- Role-based access control (admin/user)
- API key encryption for exchange credentials
- CSRF protection and security headers
- Rate limiting on all endpoints with stricter limits for auth/upload
- Secure HttpOnly cookies for token storage
- File upload validation and restrictions

## Development Workflow

### Code Style

- ESLint configuration enforces import ordering and Angular conventions
- Prettier for consistent code formatting with 120 character line length
- Pre-commit hooks automatically fix linting issues and format code
- Import order: Angular → NestJS → third-party → internal → relative

### Testing

- Jest for unit tests
- Cypress for e2e tests
- **Run a single test file**: `npx nx test api --testFile='confluence.strategy'`
  - Do NOT use `--testPathPattern` — the Nx Jest executor splits it into individual characters, matching all files
- API endpoints documented with Bruno collection in `docs/bruno/`

### Database & Migrations

- TypeORM with PostgreSQL
- Migration files in `apps/api/src/migrations/`
- Entities use decorators for database mapping
- **NEVER use `uuid_generate_v4()`** in migrations — it requires the `uuid-ossp` extension which is not available.
  **Always use `gen_random_uuid()`** instead (built into PostgreSQL 13+ natively)

### Queue Management

- BullMQ dashboard available at `/api/admin/queues` (admin only)
- Background jobs organized by domain (orders, prices, balances, etc.)

### API Documentation

- Swagger/OpenAPI documentation available when running API
- Bruno collection provides comprehensive API testing examples

## Important Implementation Notes

### Order Synchronization

The order sync system (`apps/api/src/order/tasks/order-sync.task.ts`) runs hourly and:

1. Fetches orders from connected exchanges using CCXT
2. Processes multiple exchanges in parallel
3. Identifies new/changed orders and saves to database
4. Handles exchange-specific data mapping and fee calculations

### Portfolio Management

Portfolio module tracks investment performance with:

- Historical price data collection
- Asset allocation calculations
- Performance metrics and charts
- Multi-exchange portfolio aggregation

### Price Data & Coin Detail Pages

- Real-time price feeds from CoinGecko API
- Historical price storage for charting
- Redis caching layer to minimize API calls (5-minute TTL)
- Dedicated coin detail pages at `/app/coins/:slug` with:
  - Comprehensive market statistics and price charts
  - Auto-refreshing price data (45-second intervals)
  - User holdings display (authenticated users only)
  - Multiple chart time periods (24h, 7d, 30d, 1y)
  - External resource links (website, blockchain explorers, GitHub, Reddit)

**Coin Detail API Endpoints:**

- `GET /coins/:slug` - Comprehensive coin detail (optional auth for holdings)
- `GET /coins/:slug/chart?period={24h|7d|30d|1y}` - Market chart data
- `GET /coins/:slug/holdings` - User holdings (requires auth)

**Key Implementation Details:**

- Uses TanStack Query for client-side state management and caching
- Frontend components in `apps/chansey/src/app/coins/`
- Backend services in `apps/api/src/coin/coin.service.ts` (see T015-T022 methods)
- Redis caching in `fetchCoinDetail()` and `fetchMarketChart()` methods
- Hybrid data model: Public CoinGecko data + private user holdings from exchange orders

When working with this codebase, prioritize understanding the exchange integration patterns and background job
processing, as these are core to the application's functionality.

### Pipeline & Backtest Architecture

**User Isolation Model**: Pipelines and backtests are **strictly user-specific**. Each has a mandatory `user` FK with
cascade delete. Users cannot see each other's results - all queries filter by `user.id`.

**What Makes Each Run Unique**:

| Factor             | Description                                           |
| ------------------ | ----------------------------------------------------- |
| User               | Each run belongs to one user                          |
| Algorithm          | Which trading algorithm to use                        |
| Strategy Params    | User-specific parameter overrides (e.g., MA periods)  |
| Market Data Set    | Which historical data to backtest against             |
| Date Range         | Start/end dates for the backtest period               |
| Initial Capital    | Starting portfolio value                              |
| Trading Fee        | Commission percentage                                 |
| Slippage Model     | How to simulate execution slippage                    |
| Risk Level (1-5)   | User's risk profile drives all pipeline stage configs |
| Exchange Key       | User's specific exchange credentials                  |
| Deterministic Seed | For reproducibility                                   |

**Shared vs User-Specific Resources**:

| Shared (Global)  | User-Specific                      |
| ---------------- | ---------------------------------- |
| Algorithms       | Strategy Configs (param overrides) |
| Market Data Sets | Exchange Keys                      |
|                  | Backtests & Pipelines              |
|                  | Risk Profile                       |

**Risk-Based Configuration** (determines pipeline stage behavior):

| Risk Level       | Paper Trading | Training Period | Max Drawdown |
| ---------------- | ------------- | --------------- | ------------ |
| 1 (Conservative) | 14 days       | 180 days        | 15%          |
| 3 (Moderate)     | 7 days        | 90 days         | 25%          |
| 5 (Aggressive)   | 3 days        | 30 days         | 40%          |

**Pipeline Stage Flow**: `OPTIMIZE → HISTORICAL → LIVE_REPLAY → PAPER_TRADING → COMPLETED`

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
