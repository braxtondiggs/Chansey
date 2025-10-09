# Phase 1: Data Model

## Overview
This document describes the data structures displayed in the enhanced crypto-trading component template. All entities already exist in the backend - this enhancement only adds UI display logic. No database schema changes are required.

## Entities

### Order
**Purpose**: Represents a cryptocurrency trading order placed by a user

**Location**: `apps/api/src/order/order.entity.ts` (EXISTING - no changes)

**Key Attributes**:
- `id` (string, UUID): Unique order identifier
- `symbol` (string): Trading pair symbol (e.g., "BTC/USDT")
- `side` (enum): BUY or SELL
- `type` (enum): MARKET, LIMIT, STOP_LOSS, STOP_LIMIT, TRAILING_STOP, TAKE_PROFIT, OCO
- `quantity` (number): Amount of base asset to trade
- `price` (number, optional): Limit price for limit/stop-limit orders
- `stopPrice` (number, optional): Trigger price for stop orders
- `trailingAmount` (number, optional): Trailing distance for trailing stop
- `trailingType` (string, optional): 'amount' or 'percentage' for trailing stop
- `takeProfitPrice` (number, optional): Take profit price for OCO orders
- `stopLossPrice` (number, optional): Stop loss price for OCO orders
- `executedQuantity` (number): Amount filled so far
- `status` (enum): NEW, PARTIALLY_FILLED, FILLED, CANCELED, REJECTED, EXPIRED
- `transactTime` (Date): When order was placed
- `baseCoin` (relation): Base currency coin
- `quoteCoin` (relation): Quote currency coin
- `user` (relation): Order owner
- `exchange` (relation): Exchange where order was placed

**Display Requirements**:
- Active Orders Table: Show id, symbol, type, side, quantity, executedQuantity, price, status, transactTime
- Status Badge: Apply color-coded class using `getStatusClass(status)` helper
- Cancel Button: Show only for status NEW or PARTIALLY_FILLED
- Filled Progress: Display `executedQuantity / quantity` as percentage

**Validation Rules** (enforced by backend):
- Quantity must be > 0.00001
- Price required for LIMIT and STOP_LIMIT types
- Stop price required for STOP_LOSS and STOP_LIMIT types
- Trailing amount required for TRAILING_STOP type
- Take profit and stop loss prices required for OCO type

### OrderPreview
**Purpose**: Real-time cost and fee calculation for an order before submission

**Location**: `apps/api/src/order/dto/order-preview.dto.ts` (EXISTING - no changes)

**Key Attributes**:
- `estimatedCost` (number): Order value (quantity × price)
- `estimatedFee` (number): Trading fee charged by exchange
- `totalRequired` (number): Total funds needed (cost + fee) for buy orders
- `availableBalance` (number): User's current balance in relevant currency
- `hasSufficientBalance` (boolean): Whether user can afford the order
- `warnings` (string[], optional): Advisory messages (e.g., "Market volatility high")

**Display Requirements**:
- Preview Card: Show estimatedCost, estimatedFee, totalRequired
- Balance Check: Display availableBalance and comparison to totalRequired
- Insufficient Balance Warning: Show p-message severity="warn" if !hasSufficientBalance
- Real-time Updates: Recalculate on any form value change (quantity, price, type)

**Component Integration**:
- Stored in signals: `buyOrderPreview` and `sellOrderPreview`
- Updated via `previewOrderMutation.mutate(orderData)`
- Displayed using Angular @if syntax: `@if (buyOrderPreview(); as preview) { }`

### TradingPair
**Purpose**: Cryptocurrency trading pair information with market data

**Location**: `apps/api/src/exchange/ticker-pair.entity.ts` (EXISTING - no changes)

**Key Attributes**:
- `symbol` (string): Trading pair symbol (e.g., "BTCUSDT")
- `baseAsset` (Coin): Base cryptocurrency (e.g., Bitcoin)
- `quoteAsset` (Coin): Quote cryptocurrency (e.g., USDT)
- `currentPrice` (number): Latest market price
- `spreadPercentage` (number): 24-hour price change percentage
- `exchange` (relation): Exchange where pair is traded

**Display Requirements**:
- Market Price Display: Show currentPrice prominently
- Price Change: Display spreadPercentage with color coding (green if positive, red if negative)
- Pair Selector: Format as "BTC/USDT" in dropdown
- Reference Price: Show near limit price inputs for context

**Component Integration**:
- Computed signal: `selectedPair()` returns current TradingPair or null
- Helper method: `priceChangeClass()` returns 'text-green-600' or 'text-red-600'
- Price displayed using: `{{ selectedPair()?.currentPrice | currency }}`

### ExchangeBalance
**Purpose**: User's cryptocurrency balance on a specific exchange

**Location**: Component service return type (no entity, DTO from backend)

**Key Attributes**:
- `coin` (Coin): Cryptocurrency coin information
- `available` (number): Available balance for trading
- `reserved` (number): Balance locked in open orders
- `total` (number): Total balance (available + reserved)

**Display Requirements**:
- Buy Balance: Show quote currency balance (e.g., USDT balance for BTC/USDT pair)
- Sell Balance: Show base currency balance (e.g., BTC balance for BTC/USDT pair)
- Post-Trade Balance: Calculate remaining balance after order execution
- Balance Labels: "Available: X.XXX BTC" with currency symbol

**Component Integration**:
- Helper methods: `getAvailableBuyBalance()`, `getAvailableSellBalance()`
- Fetched from: `balancesQuery.data()` (TanStack Query)
- Displayed using: `{{ getAvailableBuyBalance() | number:'1.2-8' }}`

### OrderBook
**Purpose**: Real-time market depth showing current bids and asks

**Location**: Component service return type (no entity, real-time market data)

**Key Attributes**:
- `bids` (array): Buy orders sorted by price descending
  - Each bid: `{ price: number, quantity: number }`
- `asks` (array): Sell orders sorted by price ascending
  - Each ask: `{ price: number, quantity: number }`

**Display Requirements**:
- Bids Table: Show top 5 bids with price and quantity
- Asks Table: Show top 5 asks with price and quantity
- Click-to-Fill: Clicking a row auto-fills the price input field
- Visual Distinction: Color code bids (green) vs asks (red)
- Real-time Updates: Refresh as market data changes

**Component Integration**:
- Helper methods: `getTopBids()`, `getTopAsks()` (return first 5 entries)
- Fetched from: `orderBookQuery()?.data()` (computed signal with TanStack Query)
- trackBy function: `trackByPrice()` for efficient rendering

## Component UI State (Signals)

### Form State
- `buyOrderForm` (FormGroup): Reactive form for buy orders
- `sellOrderForm` (FormGroup): Reactive form for sell orders

Form controls (both forms):
- `type`: OrderType enum
- `quantity`: number
- `price`: number (conditional)
- `stopPrice`: number (conditional)
- `trailingAmount`: number (conditional)
- `trailingType`: 'amount' | 'percentage' (conditional)
- `takeProfitPrice`: number (conditional)
- `stopLossPrice`: number (conditional)

### Selection State
- `selectedPairValue` (signal<string | null>): Current trading pair symbol
- `selectedExchangeId` (signal<string | null>): Current exchange ID
- `activeOrderTab` (signal<string>): 'buy' or 'sell' tab
- `showActiveOrders` (signal<boolean>): Whether to display orders table

### Percentage Selection State
- `selectedBuyPercentage` (signal<number | null>): Selected percentage for buy quantity (25/50/75/100)
- `selectedSellPercentage` (signal<number | null>): Selected percentage for sell quantity (25/50/75/100)

### Preview State
- `buyOrderPreview` (signal<OrderPreview | null>): Buy order cost preview
- `sellOrderPreview` (signal<OrderPreview | null>): Sell order cost preview

## Query State (TanStack Query)

### Data Queries
- `userQuery`: User profile with connected exchanges
- `exchangeQuery`: List of supported exchanges
- `tradingPairsQuery`: Available trading pairs for selected exchange
- `balancesQuery`: User's balances across all exchanges
- `activeOrdersQuery`: User's open and partially filled orders
- `orderBookQuery`: Real-time market depth (computed based on selectedPair)

### Mutations
- `createOrderMutation`: Submit new order
- `previewOrderMutation`: Calculate order cost and fees
- `cancelOrderMutation`: Cancel an open order

**Loading States**: All queries/mutations provide `isPending()` for loading indicators
**Error States**: All queries/mutations provide `error()` for error handling

## Data Flow

### Order Placement Flow
1. User fills form → Form validators check required fields
2. Form value changes → Trigger `calculateOrderTotalWithPreview(side)`
3. Preview mutation called → Returns OrderPreview
4. Preview signal updated → UI shows cost/fees/balance check
5. User clicks submit → `createOrderMutation.mutate(orderData)`
6. Success → Toast notification, form reset, orders refetch
7. Error → Toast error message, button re-enabled

### Order Cancellation Flow
1. User clicks cancel on active order → `cancelOrderMutation.mutate(orderId)`
2. Success → Toast notification, orders refetch (order removed from list)
3. Error → Toast error message

### Order Book Interaction Flow (NEW)
1. User clicks bid/ask row → `fillPriceFromOrderBook(price, side)`
2. Method updates form price control → Form validators re-run
3. Form change triggers preview update → New cost calculation
4. User sees updated preview → Can adjust before submitting

## Validation Rules Display

### Field-Level Validation
- **Quantity**:
  - Required: "Quantity is required"
  - Min value: "Minimum quantity is 0.001"

- **Price** (when visible):
  - Required: "Price is required for limit orders"
  - Min value: "Price must be greater than 0"

- **Stop Price** (when visible):
  - Required: "Stop price is required"
  - Min value: "Stop price must be greater than 0"

- **Trailing Amount** (when visible):
  - Required: "Trailing amount is required"
  - Min value: "Trailing amount must be greater than 0"

- **Take Profit Price** (when visible):
  - Required: "Take profit price is required"
  - Min value: "Take profit price must be greater than 0"

- **Stop Loss Price** (when visible):
  - Required: "Stop loss price is required"
  - Min value: "Stop loss price must be greater than 0"

### Form-Level Validation
- **Exchange Selection**: If `selectedExchangeId()` is null, show warning message and disable forms
- **Pair Selection**: If `selectedPair()` is null, disable submit buttons
- **Insufficient Balance**: If `!preview.hasSufficientBalance`, disable submit button and show warning

## Status Enums and Display Mapping

### OrderStatus → CSS Classes (via getStatusClass)
- `NEW` → "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
- `PARTIALLY_FILLED` → "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
- `FILLED` → "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
- `CANCELED` → "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
- `REJECTED` → "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"
- `EXPIRED` → "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"

### OrderSide → Display
- `BUY` → "Buy" button (green theme)
- `SELL` → "Sell" button (red theme)

### OrderType → Form Fields Visibility
- `MARKET` → quantity only
- `LIMIT` → quantity + price
- `STOP_LOSS` → quantity + stopPrice
- `STOP_LIMIT` → quantity + stopPrice + price
- `TRAILING_STOP` → quantity + trailingAmount + trailingType
- `TAKE_PROFIT` → quantity + takeProfitPrice
- `OCO` → quantity + takeProfitPrice + stopLossPrice

## Summary

**No New Entities Required**: All data structures already exist in the backend and component services

**Template Displays**:
- 5 existing entities (Order, OrderPreview, TradingPair, ExchangeBalance, OrderBook)
- 6 component signals for UI state
- 6 TanStack Query hooks for data fetching
- 3 mutations for user actions

**Data Changes**: All read-only from template perspective - mutations handled by existing backend endpoints

**Next Phase**: Create quickstart.md with test scenarios for all 10 UI features
