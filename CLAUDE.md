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
- **apps/chansey** - Angular 19 frontend with PrimeNG UI components
- **apps/chansey-e2e** - Cypress end-to-end tests
- **libs/api-interfaces** - Shared TypeScript interfaces between API and frontend

### Key Technologies
- **Backend**: NestJS, TypeORM, PostgreSQL, Redis, BullMQ (job queues)
- **Frontend**: Angular 19, PrimeNG, TailwindCSS, PWA support
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
- API endpoints documented with Bruno collection in `docs/bruno/`

### Database & Migrations
- TypeORM with PostgreSQL
- Migration files in `apps/api/src/migrations/`
- Entities use decorators for database mapping

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

### Price Data
- Real-time price feeds from CoinGecko API
- Historical price storage for charting
- Caching layer to minimize API calls

When working with this codebase, prioritize understanding the exchange integration patterns and background job processing, as these are core to the application's functionality.
