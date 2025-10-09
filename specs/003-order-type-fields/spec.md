# Feature Specification: Complete Crypto Trading UI Enhancement

**Feature Branch**: `003-order-type-fields`
**Created**: 2025-10-09
**Status**: Draft
**Input**: User description: "Order Type Fields - The component validates all order types (Market, Limit, Stop Loss, etc.) but the template doesn't show the appropriate input fields. Users need to see price fields for limit orders, stop prices for stop-loss orders, and trailing amounts for trailing stops. Add *ngIf directives using your existing helper methods: shouldShowPriceField(), shouldShowStopPriceField(), shouldShowTrailingFields(), shouldShowTakeProfitField(), and shouldShowStopLossField(). Each order type requires specific inputs - limit orders need price, stop-limits need both stop and limit prices, OCO orders need take profit and stop loss prices. Order Preview - Your buyOrderPreview and sellOrderPreview signals store preview data, but it's not displayed. Users need to see estimated cost, trading fees, total required funds, available balance, and whether they have sufficient funds before submitting. This preview should update in real-time as they input values, helping them understand the impact of fees and whether they can afford the trade. Active Orders - The activeOrdersQuery fetches data and cancelOrderMutation is ready, but there's no table to display orders. Add a table showing date, pair, type, side, price, quantity, filled amount, status (using your getStatusClass()), and cancel buttons for \"NEW\" or \"PARTIALLY_FILLED\" orders. Market Price Display - Users entering limit/stop prices need current market context. Display selectedPair()?.currentPrice prominently with the 24-hour change styled using priceChangeClass(). This helps users set informed limit prices. Validation Feedback - Forms have validation rules but no visual feedback. Add isFieldInvalid() and getFieldError() methods to show error messages below invalid fields using p-error class. Users need to know why their input is rejected, especially for the quantity field's minimum value requirement. Submit Button States - Disable buy/sell buttons when forms are invalid or balance is insufficient: [disabled]=\"!buyOrderForm.valid || !buyOrderPreview()?.hasSufficientBalance\". Show loading state during submission with createOrderMutation.isPending(). Exchange Selection - When selectedExchangeId() is null, show a prominent message prompting users to select an exchange. The trading interface should be disabled until an exchange is selected. Balance Display - Show available balances using getAvailableBuyBalance() and getAvailableSellBalance() in the UI. Display how much balance remains after the trade, updating in real-time as users input quantities. Percentage Buttons - Your quickAmountOptions and percentage methods exist, but the 25%/50%/75%/Max buttons aren't in the template. Add PrimeNG SelectButton components that use setQuantityPercentage() and calculateMaxBuyQuantityWithFees() for the Max button. Order Book - The orderBookQuery fetches data and you have getTopBids()/getTopAsks() methods, but no order book widget exists. Add a table showing current bids/asks so users can see market depth and click prices to auto-fill their orders."

## Execution Flow (main)
```
1. Parse user description from Input
   → Input provided: Complete crypto trading UI enhancement with 10 distinct features
2. Extract key concepts from description
   → Identified: Traders, Order types, Real-time previews, Active order management, Market context
3. For each unclear aspect:
   → All features clearly specified with existing component methods referenced
4. Fill User Scenarios & Testing section
   → Multiple user flows across different order types and trading scenarios
5. Generate Functional Requirements
   → 40+ testable requirements across 10 feature areas
6. Identify Key Entities
   → Order, OrderPreview, TradingPair, ExchangeBalance, OrderBook
7. Run Review Checklist
   → No [NEEDS CLARIFICATION] markers - all features explicitly defined
8. Return: SUCCESS (spec ready for planning)
```

---

## ⚡ Quick Guidelines
- ✅ Focus on WHAT users need and WHY
- ❌ Avoid HOW to implement (no tech stack, APIs, code structure)
- 👥 Written for business stakeholders, not developers

---

## User Scenarios & Testing

### Primary User Story
As a cryptocurrency trader, I need a comprehensive trading interface that shows me all necessary input fields based on my selected order type, provides real-time cost previews before I submit trades, displays my active orders with management capabilities, and gives me market context (current prices, order book depth) so that I can make informed trading decisions and execute orders confidently.

### Acceptance Scenarios

#### Scenario 1: Order Type-Specific Fields
1. **Given** a user has selected "Market" order type, **When** viewing the order form, **Then** only quantity field is shown (no price field)
2. **Given** a user has selected "Limit" order type, **When** viewing the order form, **Then** both quantity and price fields are shown
3. **Given** a user has selected "Stop Loss" order type, **When** viewing the order form, **Then** quantity and stop price fields are shown
4. **Given** a user has selected "Stop Limit" order type, **When** viewing the order form, **Then** quantity, stop price, and limit price fields are shown
5. **Given** a user has selected "Trailing Stop" order type, **When** viewing the order form, **Then** quantity, trailing amount, and trailing type (percentage/fixed) fields are shown
6. **Given** a user has selected "OCO" order type, **When** viewing the order form, **Then** quantity, take profit price, and stop loss price fields are shown

#### Scenario 2: Real-Time Order Preview
1. **Given** a user is placing a buy order, **When** they enter a quantity, **Then** the preview displays estimated cost, trading fees, total required funds, and available balance
2. **Given** a user's preview shows insufficient balance, **When** viewing the preview, **Then** a clear warning is displayed and submit button is disabled
3. **Given** a user modifies order quantity or price, **When** values change, **Then** preview updates instantly without requiring form submission

#### Scenario 3: Active Order Management
1. **Given** a user has active orders, **When** viewing the orders table, **Then** all orders are shown with date, pair, type, side, price, quantity, filled amount, and status
2. **Given** an order has status "NEW" or "PARTIALLY_FILLED", **When** viewing the order, **Then** a cancel button is available
3. **Given** a user clicks cancel on an active order, **When** cancellation completes, **Then** order status updates and order is removed from active list
4. **Given** an order has status "FILLED", "CANCELED", or "REJECTED", **When** viewing the order, **Then** no cancel button is shown

#### Scenario 4: Market Context Display
1. **Given** a user has selected a trading pair, **When** viewing the trading interface, **Then** current market price is prominently displayed
2. **Given** a trading pair has 24-hour price change data, **When** viewing market price, **Then** percentage change is shown with positive changes in green and negative in red
3. **Given** a user is entering a limit price, **When** viewing the form, **Then** current market price is visible as reference

#### Scenario 5: Validation Feedback
1. **Given** a user enters invalid quantity (below minimum), **When** field loses focus, **Then** error message appears below field explaining minimum requirement
2. **Given** a user leaves a required field empty, **When** attempting to submit, **Then** error messages appear for all invalid fields
3. **Given** a user corrects validation errors, **When** field becomes valid, **Then** error message disappears immediately

#### Scenario 6: Submit Button States
1. **Given** order form is invalid, **When** viewing submit button, **Then** button is disabled
2. **Given** user has insufficient balance, **When** viewing submit button, **Then** button is disabled
3. **Given** order is being submitted, **When** mutation is pending, **Then** button shows loading indicator and is disabled
4. **Given** form is valid and balance is sufficient, **When** no submission in progress, **Then** button is enabled

#### Scenario 7: Exchange Selection Requirement
1. **Given** no exchange is selected, **When** viewing trading interface, **Then** prominent message prompts user to select an exchange
2. **Given** no exchange is selected, **When** viewing order forms, **Then** all trading inputs are disabled
3. **Given** user selects an exchange, **When** selection completes, **Then** trading interface becomes fully functional

#### Scenario 8: Balance Display
1. **Given** a user is viewing buy order form, **When** form loads, **Then** available buy balance (quote currency) is displayed
2. **Given** a user is viewing sell order form, **When** form loads, **Then** available sell balance (base currency) is displayed
3. **Given** a user enters order quantity, **When** preview calculates, **Then** remaining balance after trade is shown
4. **Given** balance updates occur, **When** new balance data arrives, **Then** displayed balances update in real-time

#### Scenario 9: Percentage Quick Select
1. **Given** a user wants to trade portion of balance, **When** clicking 25% button, **Then** quantity field fills with 25% of available balance
2. **Given** a user clicks 50% button, **When** calculation completes, **Then** quantity reflects 50% of available balance
3. **Given** a user clicks 75% button, **When** calculation completes, **Then** quantity reflects 75% of available balance
4. **Given** a user clicks Max button, **When** calculation includes fees, **Then** quantity shows maximum tradeable amount after fee deduction

#### Scenario 10: Order Book Integration
1. **Given** order book data is available, **When** viewing trading interface, **Then** top bids and asks are displayed in table format
2. **Given** a user sees order book prices, **When** clicking a bid/ask price, **Then** order form price field auto-fills with selected value
3. **Given** order book updates occur, **When** new market data arrives, **Then** bid/ask table refreshes automatically

### Edge Cases
- What happens when user switches order type mid-entry? (Form should clear type-specific fields to prevent invalid combinations)
- How does system handle extremely small quantities below exchange minimums? (Show specific error with exchange's minimum requirement)
- What if order preview fails to calculate? (Show error state, disable submit, suggest checking inputs)
- How does system handle network delays during order submission? (Show loading state, prevent duplicate submissions, show timeout after reasonable period)
- What happens when user has open orders but balance becomes insufficient? (Orders remain open, new orders blocked until balance increases)
- How does interface handle rapid order book updates? (Throttle/debounce updates to prevent UI flicker)
- What if user attempts to cancel an already-filled order? (Show appropriate error message explaining order already completed)
- How does system handle partial fills during display? (Real-time update of filled amount and remaining quantity)

## Requirements

### Functional Requirements

#### Order Type Fields (FR-001 to FR-007)
- **FR-001**: System MUST display only relevant input fields based on selected order type
- **FR-002**: System MUST show price field for "Limit" order type
- **FR-003**: System MUST show stop price field for "Stop Loss" order type
- **FR-004**: System MUST show both stop price and limit price fields for "Stop Limit" order type
- **FR-005**: System MUST show trailing amount and trailing type selector for "Trailing Stop" order type
- **FR-006**: System MUST show take profit price and stop loss price fields for "OCO" order type
- **FR-007**: System MUST hide price-related fields for "Market" order type (quantity only)

#### Order Preview Display (FR-008 to FR-014)
- **FR-008**: System MUST display real-time order preview showing estimated cost
- **FR-009**: System MUST show trading fees in order preview
- **FR-010**: System MUST display total required funds (cost + fees) in preview
- **FR-011**: System MUST show user's available balance in preview
- **FR-012**: System MUST indicate whether user has sufficient balance for the trade
- **FR-013**: System MUST update preview automatically when user modifies quantity or price
- **FR-014**: System MUST maintain separate previews for buy and sell orders

#### Active Orders Management (FR-015 to FR-021)
- **FR-015**: System MUST display table of all active orders
- **FR-016**: System MUST show order date, trading pair, type, side, price, quantity, filled amount, and status for each order
- **FR-017**: System MUST display cancel button only for orders with status "NEW" or "PARTIALLY_FILLED"
- **FR-018**: System MUST allow users to cancel eligible orders via cancel button
- **FR-019**: System MUST update order status immediately after successful cancellation
- **FR-020**: System MUST apply visual styling to order status (using status-specific CSS classes)
- **FR-021**: System MUST refresh active orders list after order state changes

#### Market Price Context (FR-022 to FR-024)
- **FR-022**: System MUST prominently display current market price for selected trading pair
- **FR-023**: System MUST show 24-hour price change percentage alongside current price
- **FR-024**: System MUST apply visual styling to price change (green for positive, red for negative)

#### Validation Feedback (FR-025 to FR-028)
- **FR-025**: System MUST display error messages below invalid form fields
- **FR-026**: System MUST show specific validation error explaining why input is rejected
- **FR-027**: System MUST highlight quantity field errors when value is below minimum requirement
- **FR-028**: System MUST remove error messages immediately when user corrects invalid input

#### Submit Button States (FR-029 to FR-032)
- **FR-029**: System MUST disable submit button when order form contains validation errors
- **FR-030**: System MUST disable submit button when user has insufficient balance
- **FR-031**: System MUST show loading indicator on submit button during order submission
- **FR-032**: System MUST prevent duplicate submissions while order creation is in progress

#### Exchange Selection (FR-033 to FR-035)
- **FR-033**: System MUST display prominent message prompting exchange selection when no exchange is selected
- **FR-034**: System MUST disable all trading inputs when no exchange is selected
- **FR-035**: System MUST enable full trading functionality immediately after exchange selection

#### Balance Display (FR-036 to FR-038)
- **FR-036**: System MUST display available balance for the relevant currency (quote for buy, base for sell)
- **FR-037**: System MUST show calculated remaining balance after trade execution
- **FR-038**: System MUST update balance display in real-time as balance data changes

#### Percentage Quick Select (FR-039 to FR-042)
- **FR-039**: System MUST provide quick select buttons for 25%, 50%, 75%, and Max percentage of available balance
- **FR-040**: System MUST calculate quantity based on selected percentage when user clicks percentage button
- **FR-041**: System MUST account for trading fees when calculating Max quantity
- **FR-042**: System MUST auto-fill quantity field with calculated amount after percentage selection

#### Order Book Integration (FR-043 to FR-045)
- **FR-043**: System MUST display order book showing top bids and asks
- **FR-044**: System MUST allow users to auto-fill price field by clicking order book prices
- **FR-045**: System MUST update order book display automatically as market data changes

### Key Entities

- **Order**: Represents a trading order with attributes including order type (Market, Limit, Stop Loss, Stop Limit, Trailing Stop, Take Profit, OCO), side (Buy/Sell), quantity, prices (limit price, stop price, take profit price, stop loss price), status (NEW, PARTIALLY_FILLED, FILLED, CANCELED, REJECTED, EXPIRED), filled amount, trading pair, and timestamps

- **OrderPreview**: Calculation result showing estimated cost of trade, applicable trading fees, total required funds (cost + fees), user's available balance, and sufficiency indicator (whether user can afford the trade)

- **TradingPair**: Represents a cryptocurrency trading pair with base currency, quote currency, current market price, 24-hour price change amount and percentage, and trading status

- **ExchangeBalance**: User's balance on selected exchange including available balance per currency, reserved balance (in open orders), and total balance

- **OrderBook**: Real-time market depth data containing lists of current bid orders (buy side) and ask orders (sell side), each with price and quantity information

---

## Review & Acceptance Checklist

### Content Quality
- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

### Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

---

## Execution Status

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked (none found - all features clearly specified)
- [x] User scenarios defined (10 scenario groups with 20+ acceptance tests)
- [x] Requirements generated (45 functional requirements across 10 feature areas)
- [x] Entities identified (5 key entities)
- [x] Review checklist passed

---
