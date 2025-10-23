# Chansey

A modern cryptocurrency portfolio management application built with Angular and NestJS. Track your investments across
multiple exchanges, monitor performance, and manage your crypto portfolio with real-time data synchronization.

## 🚀 Features

- **Multi-Exchange Support**: Connect to Binance, Coinbase, and other major cryptocurrency exchanges
- **Real-Time Synchronization**: Automated order and balance updates via background job processing
- **Portfolio Analytics**: Track performance, asset allocation, and historical data
- **Secure API Integration**: Encrypted storage of exchange API keys with JWT authentication
- **Responsive PWA**: Mobile-first design with offline capabilities
- **Admin Dashboard**: Queue management and system monitoring tools

## 🛠 Technology Stack

### Frontend (apps/chansey)

- **Angular 20** with standalone components
- **PrimeNG** UI component library
- **TailwindCSS** for styling
- **TanStack Query** for state management and caching
- **PWA** with service worker support

### Backend (apps/api)

- **NestJS** REST API framework
- **TypeORM** with PostgreSQL database
- **Redis** for caching and session storage
- **BullMQ** for background job processing
- **CCXT** for cryptocurrency exchange integration
- **JWT** authentication with refresh tokens

### Infrastructure

- **Railway** deployment platform
- **Minio** for file storage
- **CoinGecko API** for price data

## 📋 Prerequisites

- **Node.js** 22+ and npm
- **PostgreSQL** 14+
- **Redis** 6+
- **Git**

## 🔧 Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/braxtondiggs/Chansey.git
cd Chansey
npm install
```

### 2. Environment Setup

Create environment files for both applications:

**apps/api/.env**

```env
DATABASE_URL=postgresql://username:password@localhost:5432/chansey
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-jwt-secret
COINGECKO_API_KEY=your-coingecko-api-key
```

**apps/chansey/.env**

```env
API_URL=http://localhost:3000/api
```

### 3. Database Setup

```bash
# Run database migrations
npm run db:migrate

# Seed initial data (optional)
npm run db:seed
```

### 4. Start Development Servers

```bash
# Start both API and frontend
npm start

# Or start individually
npm run api    # API server on http://localhost:3000
npm run site   # Frontend on http://localhost:4200
```

## 📜 Development Commands

### Essential Commands

```bash
npm start           # Start both applications
npm run build       # Build all applications
npm run test        # Run all tests
npm run lint        # Run ESLint on all projects
npm run format      # Format code with Prettier
npm run e2e         # Run Cypress end-to-end tests
```

### Nx-Specific Commands

```bash
nx serve api                # Serve API only
nx serve chansey           # Serve frontend only
nx build api --prod        # Production build for API
nx affected:test           # Test only affected projects
nx affected:lint           # Lint only affected projects
nx dep-graph              # View project dependency graph
```

### Database Operations

```bash
npm run db:migrate         # Run database migrations
npm run db:migration:create # Create new migration
npm run db:seed           # Seed database with initial data
```

## 🏗 Architecture Overview

### Monorepo Structure

```
├── apps/
│   ├── api/              # NestJS API server
│   ├── chansey/          # Angular frontend
│   └── chansey-e2e/      # Cypress E2E tests
├── libs/
│   └── api-interfaces/   # Shared TypeScript interfaces
└── docs/
    └── bruno/           # API documentation and testing
```

### Key Features

#### Exchange Integration

- Standardized exchange API interactions via CCXT library
- Secure API key storage with encryption
- Automated order synchronization via scheduled tasks
- Support for multiple exchanges per user

#### Background Processing

- **BullMQ** job queues with Redis backend
- Scheduled tasks for:
  - Order synchronization (hourly)
  - Price data updates
  - Balance calculations
  - Portfolio historical data collection

#### Security & Authentication

- JWT-based authentication with refresh tokens
- Role-based access control (admin/user)
- API key encryption for exchange credentials
- Rate limiting and security headers
- CSRF protection

## 🧪 Testing

```bash
# Unit tests
npm run test

# E2E tests
npm run e2e

# Test specific application
nx test api
nx test chansey

# Test affected projects only
nx affected:test
```

## 📊 Monitoring

- **Queue Dashboard**: Available at `/api/admin/queues` (admin only)
- **API Documentation**: Swagger/OpenAPI docs when running API
- **Bruno Collection**: Comprehensive API testing in `docs/bruno/`

## 🚀 Deployment

The application is deployed on Railway with PostgreSQL and Redis add-ons. See deployment documentation for detailed
setup instructions.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Follow the existing code style and run `npm run lint`
4. Write tests for new functionality
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

Built with ❤️ using [Nx](https://nx.dev) monorepo tooling
