# Chansey

[![CI](https://github.com/braxtondiggs/Chansey/actions/workflows/ci.yml/badge.svg)](https://github.com/braxtondiggs/Chansey/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-22+-green.svg)](https://nodejs.org/)
[![Angular](https://img.shields.io/badge/Angular-20-red.svg)](https://angular.dev/)
[![NestJS](https://img.shields.io/badge/NestJS-11-red.svg)](https://nestjs.com/)

A cryptocurrency portfolio management and algorithmic trading platform with a comprehensive strategy validation
pipeline. Track investments across multiple exchanges, develop trading algorithms, and validate strategies through
rigorous backtesting before deployment.

## Features

### Portfolio Management

- **Multi-Exchange Support** - Connect to Binance, Coinbase, Kraken, and more via CCXT
- **Real-Time Sync** - Automated order and balance synchronization via background jobs
- **Portfolio Analytics** - Performance tracking, asset allocation, and historical snapshots
- **Coin Details** - Market statistics, price charts, and holdings per cryptocurrency

### Strategy Development Pipeline

A 4-stage validation workflow ensures strategies are thoroughly tested before live deployment:

```
OPTIMIZE → HISTORICAL → LIVE_REPLAY → PAPER_TRADING → COMPLETED
```

| Stage             | Purpose                          | Key Thresholds             |
| ----------------- | -------------------------------- | -------------------------- |
| **Optimize**      | Walk-forward parameter tuning    | ≥5% improvement            |
| **Historical**    | Full backtest on historical data | Sharpe ≥1.0, Drawdown ≤25% |
| **Live Replay**   | Real-time pacing simulation      | Degradation ≤20%           |
| **Paper Trading** | Live market without real capital | Return ≥0%                 |

### Built-in Trading Strategies

- EMA/SMA Crossover, Triple EMA
- RSI, RSI Divergence, RSI-MACD Combo
- MACD, Bollinger Bands (Breakout & Squeeze)
- ATR Trailing Stop, Mean Reversion
- Confluence (multi-indicator consensus)

### Backtesting Modes

- **Historical** - Full-period simulations with comprehensive metrics
- **Live Replay** - Recent market data with realistic execution delays
- **Paper Trading** - Live market simulation with configurable stop conditions
- **Strategy Optimization** - Grid search parameter tuning with walk-forward analysis

### Security & Administration

- JWT authentication with refresh tokens and role-based access
- Encrypted exchange API key storage
- Admin dashboard with queue monitoring and trading kill switch
- Comprehensive audit logging

## Tech Stack

### Frontend (`apps/chansey`)

| Technology     | Purpose                        |
| -------------- | ------------------------------ |
| Angular 20     | Standalone components, signals |
| PrimeNG 20     | UI component library           |
| TailwindCSS 4  | Utility-first styling          |
| TanStack Query | Server state management        |
| Chart.js       | Data visualization             |
| PWA            | Offline support, installable   |

### Backend (`apps/api`)

| Technology    | Purpose                   |
| ------------- | ------------------------- |
| NestJS 11     | REST API framework        |
| TypeORM       | PostgreSQL ORM            |
| BullMQ        | Background job processing |
| Redis         | Caching and job queues    |
| CCXT          | Exchange connectivity     |
| Passport      | JWT authentication        |
| OpenTelemetry | Distributed tracing       |
| Pino          | Structured logging        |

### Infrastructure

| Service        | Purpose                 |
| -------------- | ----------------------- |
| PostgreSQL 15+ | Primary database        |
| Redis 6+       | Cache and queue backend |
| Railway        | Deployment platform     |
| Minio          | File storage            |
| CoinGecko API  | Market data             |

## Project Structure

```
├── apps/
│   ├── api/                 # NestJS REST API
│   │   └── src/
│   │       ├── algorithm/   # Trading strategies
│   │       ├── backtest/    # Backtesting engine
│   │       ├── pipeline/    # Validation workflow
│   │       ├── paper-trading/
│   │       ├── optimization/
│   │       ├── exchange/    # CCXT integration
│   │       ├── order/       # Order management
│   │       ├── portfolio/   # Holdings & performance
│   │       └── ...
│   ├── chansey/             # Angular frontend
│   │   └── src/app/
│   │       ├── backtesting/ # Backtest UI
│   │       ├── dashboard/   # Portfolio overview
│   │       ├── prices/      # Market data
│   │       └── ...
│   └── chansey-e2e/         # Cypress E2E tests
├── libs/
│   ├── api-interfaces/      # Shared TypeScript types
│   └── shared/              # Shared utilities
└── docs/bruno/              # API documentation
```

## Quick Start

### Prerequisites

- Node.js 22+
- PostgreSQL 15+
- Redis 6+

### Installation

```bash
git clone https://github.com/braxtondiggs/Chansey.git
cd Chansey
npm install
```

### Environment Setup

**apps/api/.env**

```env
DATABASE_URL=postgresql://user:pass@localhost:5432/chansey
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key
COINGECKO_API_KEY=your-api-key
```

**apps/chansey/.env**

```env
API_URL=http://localhost:3000/api
```

### Database Setup

```bash
npm run migration:run
```

### Start Development

```bash
# Both API and frontend
npm start

# Individual apps
npm run api    # http://localhost:3000
npm run site   # http://localhost:4200
```

## Commands

### Development

| Command             | Description             |
| ------------------- | ----------------------- |
| `npm start`         | Start API and frontend  |
| `npm run api`       | Start API only          |
| `npm run site`      | Start frontend only     |
| `npm run build`     | Build affected projects |
| `npm run build:all` | Build all projects      |

### Testing & Quality

| Command            | Description            |
| ------------------ | ---------------------- |
| `npm test`         | Run affected tests     |
| `npm run test:all` | Run all tests          |
| `npm run lint`     | Lint affected projects |
| `npm run lint:fix` | Lint and auto-fix      |
| `npm run format`   | Format with Prettier   |

### Database

| Command                    | Description           |
| -------------------------- | --------------------- |
| `npm run migration:run`    | Run migrations        |
| `npm run migration:show`   | Show migration status |
| `npm run migration:revert` | Revert last migration |

### Nx Commands

| Command               | Description            |
| --------------------- | ---------------------- |
| `nx serve api`        | Serve API              |
| `nx serve chansey`    | Serve frontend         |
| `nx build api --prod` | Production API build   |
| `nx affected:test`    | Test affected projects |
| `nx graph`            | View dependency graph  |

### Utilities

| Command                 | Description                   |
| ----------------------- | ----------------------------- |
| `npm run deps:check`    | Check for unused dependencies |
| `npm run deps:circular` | Detect circular dependencies  |
| `npm run analyze:site`  | Bundle analysis               |
| `npm run redis:flush`   | Flush Redis cache             |

## Architecture

### User Isolation Model

All pipelines, backtests, and strategies are strictly user-specific with cascade delete. Users cannot access each
other's data.

### Risk-Based Configuration

Pipeline behavior adapts to user risk profile (1-5 scale):

| Risk Level       | Paper Trading | Training Period | Max Drawdown |
| ---------------- | ------------- | --------------- | ------------ |
| Conservative (1) | 14 days       | 180 days        | 15%          |
| Moderate (3)     | 7 days        | 90 days         | 25%          |
| Aggressive (5)   | 3 days        | 30 days         | 40%          |

### Background Processing

BullMQ queues handle async operations:

- Order synchronization (hourly)
- Pipeline stage execution
- Backtest and optimization runs
- Paper trading ticks
- Price data collection

Admin queue dashboard available at `/api/admin/queues`.

### Key Entities

| Entity                | Purpose                               |
| --------------------- | ------------------------------------- |
| `User`                | Authentication and isolation boundary |
| `ExchangeKey`         | Encrypted exchange API credentials    |
| `Algorithm`           | Trading strategy implementations      |
| `StrategyConfig`      | User-specific parameter overrides     |
| `Pipeline`            | 4-stage validation workflow           |
| `Backtest`            | Historical/replay test results        |
| `PaperTradingSession` | Live simulation state                 |

## API Documentation

- **Swagger UI** - Available at `/api/docs` when running the API
- **Bruno Collection** - Comprehensive API tests in `docs/bruno/`

## Monitoring

- **Queue Dashboard** - `/api/admin/queues` (admin only)
- **Health Checks** - `/api/health`
- **Prometheus Metrics** - `/api/metrics`
- **OpenTelemetry** - Distributed tracing support

## Deployment

The application deploys on Railway with PostgreSQL and Redis add-ons. Production builds:

```bash
npm run build:api      # API build
npm run build:client   # Frontend build
npm run start:prod     # Start production API
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Follow code style (`npm run lint && npm run format`)
4. Write tests for new functionality
5. Commit changes (`git commit -m 'Add amazing feature'`)
6. Push to branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details.

---

Built with [Nx](https://nx.dev) monorepo tooling
