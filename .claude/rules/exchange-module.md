---
description: Multi-exchange support — adapter pattern, CCXT integration, encrypted API keys
globs:
  - "apps/api/src/exchange/**"
---

# Exchange Module

## Overview
49 files. Multi-exchange support via an adapter pattern with `BaseExchangeService` and a facade `ExchangeManagerService` for routing.

## Directory Layout
```
exchange/
├── services/
│   ├── base-exchange.service.ts    # Abstract base — extend for new exchanges
│   ├── binance.service.ts          # Binance adapter
│   ├── coinbase.service.ts         # Coinbase adapter
│   ├── exchange-manager.service.ts # Facade with slug-based routing
│   └── exchange-selection.service.ts # Smart routing for automated trading
├── entities/
│   ├── exchange.entity.ts          # Exchange configuration
│   └── exchange-key.entity.ts      # Encrypted user API keys
├── constants/                      # Quote currencies, defaults
└── exchange.module.ts
```

## Key Patterns
- **Adapter pattern**: `BaseExchangeService` (abstract) defines 5 required properties: `exchangeSlug`, `exchangeId`, `apiKeyConfigName`, `apiSecretConfigName`, `quoteAsset`
- **Facade routing**: `ExchangeManagerService` routes by slug via switch statement
- **CCXT client caching**: `Map<string, ccxt.Exchange>` with 30min TTL, IPv4 forced
- **DI tokens**: `EXCHANGE_SERVICE`, `EXCHANGE_MANAGER_SERVICE` — symbol-based injection to break circular deps
- **Key encryption**: `ExchangeKey` entity uses AES-256-CBC via TypeORM hooks (`@BeforeInsert`/`@BeforeUpdate`)
- **Smart selection**: `ExchangeSelectionService.selectForBuy()` / `selectForSell()` with 3-step fallback

## How to Add a New Exchange
1. Create service extending `BaseExchangeService` in `services/`
2. Implement the 5 required abstract properties
3. Add to module providers
4. Add case to `ExchangeManagerService` switch routing
5. Add quote currency constant to `constants/`
6. Override any exchange-specific methods (order format, fee calc, etc.)

## Available Constants
- `EXCHANGE_QUOTE_CURRENCY` — per-exchange quote currency map
- `DEFAULT_QUOTE_CURRENCY = 'USDT'`
- `USD_QUOTE_CURRENCIES` — set of USD-equivalent currencies

## Gotchas
- CCXT clients are cached per user+exchange — don't create new instances per request
- IPv4 is forced on CCXT connections (some exchanges reject IPv6)
- `ExchangeKey` encryption happens in TypeORM hooks — don't encrypt manually before save
- The manager switch statement must be updated when adding exchanges — no auto-discovery
