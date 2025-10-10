# Feature Specification: Manual Order Placement System Overhaul

**Feature Branch**: `002-the-orders-backend`
**Created**: 2025-10-08
**Status**: Draft
**Input**: User description: "the orders backend system is broken and doesn't work very well. I would like to overhaul how orders works. currently there is a way for users to place orders on the frontend but it half implemented. work on reworking how orders work and allow for manual orders to be made across supported exchanges"

## Execution Flow (main)
```
1. Parse user description from Input
   → Feature: Overhaul broken order placement system
2. Extract key concepts from description
   → Actors: Users (traders)
   → Actions: Place manual orders, view orders
   → Data: Orders, exchanges, trading pairs
   → Constraints: Multi-exchange support, current system broken/half-implemented
3. For each unclear aspect:
   → Order types not specified [NEEDS CLARIFICATION]
   → Validation rules not specified [NEEDS CLARIFICATION]
   → Supported exchanges not listed [NEEDS CLARIFICATION]
4. Fill User Scenarios & Testing section
   → User places order on exchange
   → User views order status
   → User cancels order
5. Generate Functional Requirements
   → Order placement, validation, execution, status tracking
6. Identify Key Entities
   → Order, Exchange, Trading Pair, User
7. Run Review Checklist
   → WARN "Spec has uncertainties regarding order types and exchange list"
8. Return: SUCCESS (spec ready for planning after clarifications)
```

---

## ⚡ Quick Guidelines
- ✅ Focus on WHAT users need and WHY
- ❌ Avoid HOW to implement (no tech stack, APIs, code structure)
- 👥 Written for business stakeholders, not developers

---

## Clarifications

### Q1: Which order types should the system support?
**Answer**: Full suite including Market, Limit, Stop-Loss, Stop-Limit, Trailing Stop, Take-Profit, and OCO (One-Cancels-Other) orders

**Rationale**: Maximum flexibility for traders to execute complex trading strategies with comprehensive risk management tools. This aligns with professional trading platform expectations.

**Impact on Requirements**:
- FR-002: Expanded to support all major order types
- FR-006: Requires handling diverse exchange-specific parameters for each order type
- FR-038: UI complexity increases significantly with conditional form fields per order type
- NFR-012: Order placement time may extend for complex order types

### Q2: What reasonable price range should the system enforce for limit orders?
**Answer**: No validation - maximum freedom with user responsibility for all price inputs

**Rationale**: Professional traders need complete control over their order prices, especially during high volatility or when implementing advanced strategies. The system should trust users to set their own risk parameters rather than imposing artificial constraints.

**Impact on Requirements**:
- FR-013: Removed price range validation constraint
- NFR-010: Error messages will focus on other validation issues, not price reasonableness
- UI will include warnings for orders significantly distant from market price but will not prevent submission

### Q3: Which cryptocurrency exchanges should the system support?
**Answer**: Current connected exchanges only - support any exchange that users have already connected via existing exchange keys

**Rationale**: Leverages existing exchange connection infrastructure without requiring new integrations. Users control which exchanges are available by managing their exchange key connections. This approach minimizes development scope while providing maximum flexibility as users add new exchange connections.

**Impact on Requirements**:
- FR-028: Updated to support all exchanges users have connected (dynamic list)
- FR-029: Must query available trading pairs from each user's connected exchanges
- FR-031: Must handle fee structures for any exchange the user connects (CCXT provides standardization)
- FR-032: Must respect rate limits for any exchange (CCXT handles this automatically)
- No new exchange integration work required - reuses existing exchange key infrastructure

### Q4: How frequently should order status updates refresh from exchanges?
**Answer**: Manual refresh only with background synchronization via existing order-sync.task.ts

**Rationale**: The existing order sync task keeps the database synchronized with exchanges in the background. Users can manually refresh to see latest status on-demand. This approach minimizes API consumption, respects exchange rate limits, and avoids complexity of real-time WebSocket connections while still providing reasonably current data through the scheduled sync task.

**Impact on Requirements**:
- NFR-003: Order status updates reflect via scheduled background sync (order-sync.task.ts) plus manual user-triggered refresh
- FR-021: Status updates occur through existing sync infrastructure rather than real-time polling
- FR-032: Minimal impact on rate limits - leverages existing sync task pattern
- UI must provide manual refresh button for users who want immediate status updates
- Background sync keeps data current without user action (existing hourly pattern can be tuned if needed)

### Q5: How many concurrent order placements should the system handle?
**Answer**: 50 concurrent orders (supporting up to 10 maximum users)

**Rationale**: This capacity accommodates a small team of traders (up to 10 users) placing multiple orders simultaneously during high market volatility periods. The constraint of 10 max users provides clear capacity planning for infrastructure and aligns with a controlled user base for a manual trading system.

**Impact on Requirements**:
- NFR-004: System must handle 50 concurrent order placements without degradation
- Infrastructure planning: Database connection pool, API server resources scaled for 10 concurrent users
- Testing scenarios: Load tests should validate 50 simultaneous order submissions
- No need for complex horizontal scaling or distributed architecture
- Standard NestJS/PostgreSQL setup sufficient for this scale

---

## User Scenarios & Testing

### Primary User Story
As a cryptocurrency trader, I want to manually place buy and sell orders across multiple exchanges so that I can execute trades based on my own analysis without relying on automated algorithms. The current order system is broken and half-implemented, making it difficult or impossible to reliably place trades. I need a working, complete order placement system that allows me to:
- Select an exchange from my connected accounts
- Choose a trading pair (e.g., BTC/USD, ETH/BTC)
- Specify order type and parameters
- Execute the order and track its status
- Cancel orders if needed

### Acceptance Scenarios

#### Scenario 1: Place a Market Buy Order
1. **Given** I am logged in and have connected my Binance US exchange account
2. **When** I navigate to the trading interface
3. **And** I select Binance US as my exchange
4. **And** I select BTC/USD as the trading pair
5. **And** I choose "Market" as the order type
6. **And** I enter "Buy" as the side and "0.01" BTC as the quantity
7. **And** I click "Place Order"
8. **Then** the system MUST validate my order parameters
9. **And** the system MUST show me a preview with estimated cost and fees
10. **And** when I confirm, the system MUST submit the order to Binance US
11. **And** the system MUST display the order status as "Filled" or "Pending"
12. **And** the system MUST show the order in my order history

#### Scenario 2: Place a Limit Sell Order
1. **Given** I hold 0.5 ETH in my Coinbase account
2. **When** I select Coinbase as my exchange
3. **And** I select ETH/USD as the trading pair
4. **And** I choose "Limit" as the order type
5. **And** I enter "Sell" as the side, "0.5" ETH as quantity, and "$2,500" as limit price
6. **And** I click "Place Order"
7. **Then** the system MUST validate that I have sufficient balance
8. **And** the system MUST show order preview with limit price
9. **And** when I confirm, the system MUST place the limit order on Coinbase
10. **And** the order MUST remain open until price is reached or I cancel it

#### Scenario 3: Cancel an Open Order
1. **Given** I have an open limit order on Kraken
2. **When** I view my order history
3. **And** I select the open order
4. **And** I click "Cancel Order"
5. **Then** the system MUST cancel the order on Kraken
6. **And** the order status MUST update to "Canceled"
7. **And** any locked funds MUST be returned to my available balance

#### Scenario 4: View Order Status and History
1. **Given** I have placed multiple orders across different exchanges
2. **When** I navigate to my order history
3. **Then** I MUST see all my orders with current status
4. **And** I MUST be able to filter by exchange, status, and date
5. **And** I MUST see order details including fees, executed price, and timestamps

### Edge Cases

#### Insufficient Balance
- **What happens when** a user tries to place an order without sufficient funds?
- **Expected**: System MUST validate balance before order placement, display clear error message showing available balance vs. required amount (including fees)

#### Exchange Connection Failure
- **What happens when** the exchange API is unreachable during order placement?
- **Expected**: System MUST detect connection failure, display error message, NOT persist failed order, allow retry

#### Partial Order Fills
- **What happens when** a market order is only partially filled?
- **Expected**: System MUST record partial fill, update order status to "Partially Filled", show executed vs. requested quantity, keep order open if applicable

#### Invalid Trading Pair
- **What happens when** a user selects a trading pair not supported by the chosen exchange?
- **Expected**: System MUST only show valid trading pairs for selected exchange, prevent selection of invalid pairs

#### Order Conflicts
- **What happens when** a user places an order that would exceed exchange-specific limits (position size, order value, daily limits)?
- **Expected**: System MUST validate against exchange limits before submission, display specific limit violation error

#### Stale Price Data
- **What happens when** market prices change significantly between order preview and execution?
- **Expected**: For market orders, system MUST execute at current market price. For limit orders, system MUST place order at specified price regardless of market movement

---

## Requirements

### Functional Requirements

#### Order Placement
- **FR-001**: System MUST allow users to place manual orders on any of their connected exchanges
- **FR-002**: System MUST support all major order types: Market, Limit, Stop-Loss, Stop-Limit, Trailing Stop, Take-Profit, and OCO (One-Cancels-Other) orders
- **FR-002a**: System MUST provide appropriate UI fields for each order type (e.g., stop price for Stop-Loss, trail amount for Trailing Stop, both target and stop prices for OCO)
- **FR-002b**: System MUST validate order-type-specific parameters (e.g., stop price must be below market for sell stop-loss)
- **FR-003**: System MUST validate user has sufficient balance (including fees) before submitting order
- **FR-004**: System MUST show order preview with estimated cost, fees, and total before final confirmation
- **FR-005**: System MUST submit validated orders to the selected exchange's API
- **FR-006**: System MUST handle exchange-specific order parameters and formats
- **FR-007**: System MUST prevent duplicate order submissions (e.g., double-click protection)

#### Order Validation
- **FR-008**: System MUST validate minimum and maximum order sizes per exchange requirements
- **FR-009**: System MUST validate trading pair is active and supported on selected exchange
- **FR-010**: System MUST validate price precision (decimal places) matches exchange requirements
- **FR-011**: System MUST validate quantity precision matches exchange requirements
- **FR-012**: System MUST check user's available balance in real-time before order placement
- **FR-013**: System MAY display warning message when limit/stop prices are significantly distant from current market price (e.g., >50% deviation) but MUST allow order submission

#### Order Execution
- **FR-014**: System MUST execute market orders immediately at best available price
- **FR-015**: System MUST place limit orders at specified price and keep them open until filled or canceled
- **FR-016**: System MUST handle partial fills correctly, recording executed quantity and remaining quantity
- **FR-017**: System MUST record order execution details including executed price, fees, and timestamp
- **FR-018**: System MUST assign unique identifier to each order for tracking

#### Order Management
- **FR-019**: System MUST allow users to cancel open orders (not yet filled)
- **FR-020**: System MUST prevent cancellation of already-filled orders
- **FR-021**: System MUST update order status through background synchronization (order-sync.task.ts) and allow manual refresh for on-demand updates
- **FR-022**: System MUST persist all order data including status changes and updates

#### Order History & Status
- **FR-023**: System MUST display all user orders with current status (New, Filled, Partially Filled, Canceled, Rejected, Expired)
- **FR-024**: System MUST show order details: trading pair, side (buy/sell), type, quantity, price, fees, timestamps
- **FR-025**: System MUST allow filtering orders by exchange, status, date range, and trading pair
- **FR-026**: System MUST distinguish between manual orders and automated orders (from algorithms)
- **FR-027**: System MUST display order history sorted by most recent first

#### Multi-Exchange Support
- **FR-028**: System MUST support order placement on any exchange the user has connected via exchange keys (leverages existing exchange key infrastructure)
- **FR-029**: System MUST retrieve and display available trading pairs for each of the user's connected exchanges
- **FR-030**: System MUST fetch current market prices for order preview from the selected exchange
- **FR-031**: System MUST handle exchange-specific fee structures using CCXT standardization
- **FR-032**: System MUST handle different exchange API rate limits using CCXT's built-in rate limiting

#### Error Handling
- **FR-033**: System MUST display clear error messages when order placement fails
- **FR-034**: System MUST specify reason for failure (insufficient funds, invalid parameters, exchange error, etc.)
- **FR-035**: System MUST log all order-related errors for troubleshooting
- **FR-036**: System MUST gracefully handle exchange API downtime
- **FR-037**: System MUST prevent order submission when exchange is unreachable

#### User Interface
- **FR-038**: System MUST provide a complete order placement interface (fixing current half-implemented state)
- **FR-039**: Users MUST be able to select exchange from connected accounts
- **FR-040**: Users MUST be able to search/select trading pairs
- **FR-041**: Users MUST see real-time balance for selected exchange
- **FR-042**: Users MUST see order preview before final submission
- **FR-043**: Users MUST receive confirmation when order is successfully placed
- **FR-044**: Users MUST be able to view order status immediately after placement

### Non-Functional Requirements

#### Performance
- **NFR-001**: Order validation MUST complete within 2 seconds
- **NFR-002**: Order submission to exchange MUST initiate within 3 seconds of user confirmation
- **NFR-003**: Order status updates MUST be available via manual refresh and MUST be synchronized via background order-sync task (existing scheduled job pattern)

#### Reliability
- **NFR-004**: System MUST handle at least 50 concurrent order placements without performance degradation (supporting up to 10 maximum concurrent users)
- **NFR-005**: Failed order submissions MUST NOT result in duplicate orders
- **NFR-006**: Order data MUST be persisted before and after exchange submission

#### Security
- **NFR-007**: System MUST use user's authenticated exchange API credentials
- **NFR-008**: System MUST NOT expose API keys in logs or error messages
- **NFR-009**: Order placement MUST require active user session (authenticated)

#### Usability
- **NFR-010**: Error messages MUST be clear and actionable (e.g., "Insufficient balance. You have $500 but need $525 including fees")
- **NFR-011**: Order preview MUST clearly show all costs before confirmation
- **NFR-012**: Order placement flow MUST be completable in under 30 seconds for experienced users

### Key Entities

- **Order**: Represents a buy or sell request for a cryptocurrency trading pair on a specific exchange. Key attributes include: trading pair, side (buy/sell), type (market/limit/etc.), quantity, price (for limit orders), status, fees, executed quantity, timestamps (created, updated, filled). Related to User and Exchange.

- **Exchange**: Represents a cryptocurrency exchange platform (e.g., Binance US, Coinbase). Key attributes include: name, supported trading pairs, fee structure, API credentials (per user), connection status. Users can have multiple connected exchanges.

- **Trading Pair**: Represents a cryptocurrency market (e.g., BTC/USD, ETH/BTC). Key attributes include: base currency, quote currency, current price, minimum/maximum order sizes, price precision, quantity precision. Different exchanges support different trading pairs.

- **User Balance**: Represents available and locked funds for a specific currency on a specific exchange. Key attributes include: currency, available amount, locked amount (in open orders), total amount. Updated in real-time during order operations.

- **Exchange Connection**: Represents a user's authentication to an exchange with API credentials. Key attributes include: exchange, API key (encrypted), secret (encrypted), permissions, connection status, last verified timestamp.

---

## Review & Acceptance Checklist

### Content Quality
- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

### Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers remain - **All 5 clarifications resolved**:
  1. ✅ Supported order types (FR-002) - Full suite: Market, Limit, Stop-Loss, Stop-Limit, Trailing Stop, Take-Profit, OCO
  2. ✅ Limit price reasonable range (FR-013) - No validation, warnings only
  3. ✅ Supported exchanges list (FR-028) - All user-connected exchanges
  4. ✅ Order status refresh interval (NFR-003) - Manual refresh + background sync
  5. ✅ Concurrent order volume capacity (NFR-004) - 50 concurrent orders (10 max users)
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Scope is clearly bounded (manual order placement only)
- [x] Dependencies identified (exchange API credentials, exchange connections)

---

## Execution Status

- [x] User description parsed
- [x] Key concepts extracted (order placement, multi-exchange, fix broken system)
- [x] Ambiguities identified and clarified (5 clarification questions answered)
- [x] User scenarios defined (4 main scenarios + edge cases)
- [x] Requirements generated and refined (46 functional + 12 non-functional)
- [x] Entities identified (5 key entities)
- [x] Review checklist passed (all clarifications resolved)
- [x] Specification complete and ready for planning phase

---

## Next Steps

1. ✅ ~~Clarify requirements~~ - **COMPLETE**
2. **Run `/plan` command** to create technical implementation plan
3. **Review current implementation** during planning to identify what to fix/rebuild
4. **Run `/tasks` command** to generate actionable implementation tasks
5. **Begin implementation** via `/implement` command
