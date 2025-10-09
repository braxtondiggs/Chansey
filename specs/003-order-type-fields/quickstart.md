# Quickstart: Testing Crypto Trading UI Enhancements

## Prerequisites
1. Application running: `npm start` (starts both API and frontend)
2. Test user account with at least one connected exchange
3. Exchange has API keys configured with trading permissions
4. Test account has some balance for trading (can use testnet exchange)

## Feature 1: Exchange Selection Requirement

### Test Scenario: No Exchange Selected
**Steps**:
1. Navigate to trading page
2. Ensure no exchange is selected (or manually deselect)

**Expected Behavior**:
- ✓ Prominent message displayed: "Please select an exchange to start trading"
- ✓ All order form inputs are disabled
- ✓ Submit buttons are disabled
- ✓ Trading pair dropdown is disabled or empty

### Test Scenario: Exchange Selected
**Steps**:
1. Select an exchange from dropdown
2. Observe interface activation

**Expected Behavior**:
- ✓ Success message: "Switched to [Exchange Name]"
- ✓ All order form inputs become enabled
- ✓ Trading pairs load for selected exchange
- ✓ Balance displays load for exchange

**Accessibility Check**:
- Tab to exchange dropdown, use arrow keys to select
- Verify focus moves to trading pair dropdown after selection

## Feature 2: Market Price Display

### Test Scenario: Trading Pair Selected
**Steps**:
1. Select exchange (e.g., Binance)
2. Select trading pair (e.g., BTC/USDT)

**Expected Behavior**:
- ✓ Current market price displayed prominently (e.g., "$45,231.50")
- ✓ 24-hour change percentage shown (e.g., "+2.34%")
- ✓ Positive change: green text color
- ✓ Negative change: red text color
- ✓ Price updates in real-time (check WebSocket connection)

**Visual Check**:
- Price should be larger font size than surrounding text
- Percentage change should be near the price
- Color coding immediately apparent

## Feature 3: Order Type-Specific Field Visibility

### Test Scenario: Market Order
**Steps**:
1. Select "Market" order type in buy form

**Expected Behavior**:
- ✓ Quantity field visible
- ✓ Price field HIDDEN
- ✓ Stop price field HIDDEN
- ✓ Trailing amount fields HIDDEN
- ✓ Take profit/stop loss fields HIDDEN

### Test Scenario: Limit Order
**Steps**:
1. Select "Limit" order type in buy form

**Expected Behavior**:
- ✓ Quantity field visible
- ✓ Price field visible with label "Price"
- ✓ Stop price field HIDDEN
- ✓ Other fields HIDDEN

### Test Scenario: Stop Loss Order
**Steps**:
1. Select "Stop Loss" order type

**Expected Behavior**:
- ✓ Quantity field visible
- ✓ Stop price field visible with label "Stop Price"
- ✓ Limit price field HIDDEN

### Test Scenario: Stop Limit Order
**Steps**:
1. Select "Stop Limit" order type

**Expected Behavior**:
- ✓ Quantity field visible
- ✓ Stop price field visible
- ✓ Price field visible (limit price)
- ✓ Both fields properly labeled

### Test Scenario: Trailing Stop Order
**Steps**:
1. Select "Trailing Stop" order type

**Expected Behavior**:
- ✓ Quantity field visible
- ✓ Trailing amount field visible
- ✓ Trailing type selector visible (Amount/Percentage)
- ✓ Can switch between amount and percentage modes

### Test Scenario: Take Profit Order
**Steps**:
1. Select "Take Profit" order type

**Expected Behavior**:
- ✓ Quantity field visible
- ✓ Take profit price field visible
- ✓ Stop loss field HIDDEN

### Test Scenario: OCO Order
**Steps**:
1. Select "OCO" order type

**Expected Behavior**:
- ✓ Quantity field visible
- ✓ Take profit price field visible
- ✓ Stop loss price field visible
- ✓ Both fields required for submission

### Field Transition Test
**Steps**:
1. Select "Limit" order, enter price "45000"
2. Switch to "Market" order
3. Switch back to "Limit" order

**Expected Behavior**:
- ✓ Price field hidden when switching to Market
- ✓ Price field reappears when switching back to Limit
- ✓ Price value may be cleared (acceptable) or preserved (better UX)

## Feature 4: Real-Time Order Preview

### Test Scenario: Buy Order Preview
**Steps**:
1. Select BTC/USDT pair (current price: $45,000)
2. Select "Market" buy order
3. Enter quantity: 0.1 BTC

**Expected Behavior**:
- ✓ Preview section appears automatically
- ✓ Estimated cost: ~$4,500 (0.1 × $45,000)
- ✓ Trading fee: ~$4.50 (0.1% of cost)
- ✓ Total required: ~$4,504.50
- ✓ Available balance: [user's USDT balance]
- ✓ Balance check: Shows sufficient/insufficient

### Test Scenario: Insufficient Balance Warning
**Steps**:
1. Enter quantity requiring more funds than available
2. Observe preview section

**Expected Behavior**:
- ✓ Warning message: "Insufficient balance" (yellow/orange)
- ✓ Submit button disabled
- ✓ Available balance highlighted in red
- ✓ Shows shortfall amount

### Test Scenario: Real-Time Preview Updates
**Steps**:
1. Enter quantity: 0.1 BTC
2. Change to Limit order, enter price: $46,000
3. Increase quantity to 0.2 BTC

**Expected Behavior**:
- ✓ Preview updates within 500ms of each change
- ✓ Loading indicator during calculation (optional)
- ✓ All values recalculate: cost, fees, total
- ✓ Balance check re-evaluates
- ✓ No flicker or UI jumpiness

## Feature 5: Balance Display

### Test Scenario: Buy Order Balance
**Steps**:
1. Open buy order form for BTC/USDT pair

**Expected Behavior**:
- ✓ Available balance displays USDT (quote currency)
- ✓ Format: "Available: 10,000.50 USDT" with proper decimals
- ✓ Updates in real-time if balance changes

### Test Scenario: Sell Order Balance
**Steps**:
1. Switch to sell order tab for BTC/USDT pair

**Expected Behavior**:
- ✓ Available balance displays BTC (base currency)
- ✓ Format: "Available: 1.25000000 BTC" (8 decimals for crypto)
- ✓ Updates in real-time if balance changes

### Test Scenario: Remaining Balance Display
**Steps**:
1. Enter buy order quantity: 0.1 BTC at $45,000
2. Observe preview section

**Expected Behavior**:
- ✓ Shows "Remaining after trade: [amount] USDT"
- ✓ Calculation: Available - (Cost + Fees)
- ✓ Updates as quantity/price changes
- ✓ Turns red if remaining would be negative

## Feature 6: Percentage Quick Select Buttons

### Test Scenario: 25% Button (Buy Order)
**Steps**:
1. Available USDT balance: $10,000
2. BTC price: $50,000
3. Click "25%" button

**Expected Behavior**:
- ✓ Quantity field auto-fills with: 0.05 BTC
- ✓ Calculation accounts for fees: ($10,000 × 0.25) / $50,000
- ✓ 25% button shows selected state (highlighted)
- ✓ Preview updates automatically

### Test Scenario: Max Button Accounting for Fees
**Steps**:
1. Available USDT balance: $10,000
2. BTC price: $50,000
3. Trading fee: 0.1%
4. Click "Max" button

**Expected Behavior**:
- ✓ Quantity calculates max possible after fees
- ✓ Formula: (Balance × (1 - feeRate)) / price
- ✓ Result: ~0.1998 BTC (not 0.2 BTC)
- ✓ Preview shows will use ~99.9% of balance (leaves dust for fees)

### Test Scenario: Percentage Button State
**Steps**:
1. Click "50%" button
2. Manually edit quantity field
3. Click "75%" button

**Expected Behavior**:
- ✓ 50% button highlights when clicked
- ✓ Manual edit deselects 50% button
- ✓ 75% button highlights, replacing 50% highlight
- ✓ Only one percentage button highlighted at a time

## Feature 7: Validation Feedback

### Test Scenario: Required Field Validation
**Steps**:
1. Focus on quantity field
2. Leave it empty
3. Click outside field (blur)

**Expected Behavior**:
- ✓ Error message appears below field: "Quantity is required"
- ✓ Field border turns red
- ✓ Error has p-error class (red text, small font)
- ✓ Submit button remains disabled

### Test Scenario: Minimum Value Validation
**Steps**:
1. Enter quantity: 0.0000001 (below 0.001 minimum)
2. Blur field

**Expected Behavior**:
- ✓ Error message: "Minimum quantity is 0.001"
- ✓ Field marked as invalid
- ✓ Submit button disabled

### Test Scenario: Error Message Clearance
**Steps**:
1. Trigger quantity required error
2. Enter valid quantity: 0.1

**Expected Behavior**:
- ✓ Error message disappears immediately
- ✓ Field border returns to normal
- ✓ Submit button enables (if all other fields valid)

### Test Scenario: Limit Order Price Required
**Steps**:
1. Select "Limit" order type
2. Leave price field empty
3. Try to submit

**Expected Behavior**:
- ✓ Error appears on price field: "Price is required for limit orders"
- ✓ Submit button disabled
- ✓ Both quantity AND price errors can show simultaneously

## Feature 8: Submit Button States

### Test Scenario: Invalid Form Disabled State
**Steps**:
1. Leave quantity empty
2. Observe submit button

**Expected Behavior**:
- ✓ Button shows disabled state (grayed out)
- ✓ Cursor shows "not-allowed" on hover
- ✓ Click does nothing
- ✓ Button text remains "Buy [Symbol]"

### Test Scenario: Insufficient Balance Disabled State
**Steps**:
1. Enter valid quantity requiring $5,000
2. User only has $1,000 balance

**Expected Behavior**:
- ✓ Button disabled even though form valid
- ✓ Tooltip/message explains: "Insufficient balance"
- ✓ Cannot submit order

### Test Scenario: Loading State During Submission
**Steps**:
1. Fill valid order form
2. Click submit button
3. Observe button during API call

**Expected Behavior**:
- ✓ Button shows loading spinner/indicator
- ✓ Button disabled during submission
- ✓ Button text may change to "Placing order..."
- ✓ aria-busy="true" for screen readers
- ✓ Cannot submit duplicate order

### Test Scenario: Success State Re-enable
**Steps**:
1. Submit valid order
2. Wait for success response

**Expected Behavior**:
- ✓ Success toast notification appears
- ✓ Form resets to default values
- ✓ Submit button re-enables
- ✓ Preview clears
- ✓ Percentage buttons deselect

## Feature 9: Active Orders Table

### Test Scenario: Active Orders Display
**Prerequisites**: User has at least 2 active orders

**Steps**:
1. Navigate to trading page
2. Observe active orders section

**Expected Behavior**:
- ✓ Table shows all active orders (NEW, PARTIALLY_FILLED)
- ✓ Columns: Date, Pair, Type, Side, Price, Quantity, Filled, Status
- ✓ Date formatted: "Oct 9, 2025 3:45 PM"
- ✓ Side: "BUY" in green or "SELL" in red
- ✓ Status: Color-coded badge (blue for NEW, yellow for PARTIALLY_FILLED)
- ✓ Filled: Shows "0.05 / 0.10 BTC" (progress format)

### Test Scenario: Cancel Button Visibility
**Prerequisites**: Mix of NEW, PARTIALLY_FILLED, and FILLED orders

**Steps**:
1. Review each order row

**Expected Behavior**:
- ✓ NEW orders: Cancel button visible
- ✓ PARTIALLY_FILLED orders: Cancel button visible
- ✓ FILLED orders: NO cancel button
- ✓ CANCELED orders: NO cancel button
- ✓ REJECTED orders: NO cancel button

### Test Scenario: Order Cancellation
**Steps**:
1. Click cancel button on NEW order
2. Confirm cancellation (if confirmation dialog appears)
3. Wait for response

**Expected Behavior**:
- ✓ Loading indicator on cancel button
- ✓ Success toast: "Order cancelled successfully"
- ✓ Order disappears from table OR status updates to CANCELED
- ✓ Order book/balance may update if order was affecting them

### Test Scenario: Real-Time Order Updates
**Prerequisites**: Place a limit order that will fill

**Steps**:
1. Place limit buy order at current market price
2. Wait for order to fill
3. Observe table updates

**Expected Behavior**:
- ✓ "Filled" column updates in real-time
- ✓ Status badge changes from NEW → PARTIALLY_FILLED → FILLED
- ✓ Cancel button disappears when status becomes FILLED
- ✓ No page refresh required

## Feature 10: Order Book Display

### Test Scenario: Order Book Rendering
**Steps**:
1. Select trading pair (e.g., BTC/USDT)
2. Observe order book section

**Expected Behavior**:
- ✓ Two tables side-by-side or stacked on mobile
- ✓ Left/Top: Bids (buy orders) - green theme
- ✓ Right/Bottom: Asks (sell orders) - red theme
- ✓ Each shows top 5 orders
- ✓ Columns: Price, Quantity
- ✓ Bids sorted: highest price first
- ✓ Asks sorted: lowest price first

### Test Scenario: Click-to-Fill Price
**Steps**:
1. View order book bids: [50000, 49999, 49998, 49997, 49996]
2. Click on row with price 49999
3. Observe buy order form

**Expected Behavior**:
- ✓ Buy form's price field auto-fills with 49999
- ✓ Order type changes to "Limit" if it was "Market"
- ✓ Visual feedback on clicked row (highlight/flash)
- ✓ Preview updates with new price
- ✓ User can immediately submit or adjust

### Test Scenario: Order Book Real-Time Updates
**Prerequisites**: Active market with frequent trades

**Steps**:
1. Watch order book for 30 seconds

**Expected Behavior**:
- ✓ Prices/quantities update without full page refresh
- ✓ Updates throttled to prevent flicker (~500ms debounce)
- ✓ Smooth transitions when rows change
- ✓ Top 5 maintained (new entries push out old ones)

## Cross-Feature Integration Tests

### Test Scenario: Complete Order Flow
**Steps**:
1. Select exchange: Binance
2. Select pair: BTC/USDT
3. View market price: $45,231
4. Check balance: 10,000 USDT available
5. Select "Limit" buy order
6. Click "50%" button → quantity: ~0.11 BTC
7. Click order book ask at $45,230
8. Review preview: Cost $4,975, Fee $4.98, Total $4,979.98
9. Verify sufficient balance
10. Submit order
11. Verify order appears in active orders table
12. Cancel order

**Expected Behavior**:
- ✓ All steps execute smoothly without errors
- ✓ Real-time updates work throughout
- ✓ Order creation and cancellation succeed
- ✓ No console errors
- ✓ All UI elements respond correctly

### Test Scenario: Mobile Responsiveness
**Steps**:
1. Resize browser to mobile width (375px)
2. Repeat major test scenarios

**Expected Behavior**:
- ✓ Forms stack vertically
- ✓ Tables show horizontal scroll if needed
- ✓ Touch targets meet 44x44px minimum
- ✓ Order book switches to single column
- ✓ Percentage buttons remain usable
- ✓ No text truncation or overflow

## Accessibility Testing

### Keyboard Navigation Test
**Steps**:
1. Tab through entire trading interface
2. Use arrow keys in dropdowns
3. Press Enter/Space on buttons

**Expected Behavior**:
- ✓ Focus visible at all times (outline/ring)
- ✓ Logical tab order: Exchange → Pair → Type → Fields → Buttons
- ✓ Trapped focus in modals (if any)
- ✓ Escape key closes dropdowns
- ✓ All interactive elements reachable

### Screen Reader Test (VoiceOver/NVDA)
**Steps**:
1. Navigate forms with screen reader
2. Submit with validation errors
3. Receive success notification

**Expected Behavior**:
- ✓ Field labels announced clearly
- ✓ Error messages announced via aria-live
- ✓ Button states announced (disabled/loading)
- ✓ Toast notifications announced
- ✓ Table headers and row relationships announced

## Performance Validation

### Load Time Test
**Steps**:
1. Clear cache
2. Navigate to trading page
3. Measure time to interactive

**Criteria**:
- ✓ First Contentful Paint: <1.5s
- ✓ Time to Interactive: <2.5s
- ✓ Component renders: <100ms after data loads

### Bundle Size Test
**Steps**:
1. Run production build: `npm run build`
2. Check bundle analyzer or build output

**Criteria**:
- ✓ Total bundle size increase: <5KB gzipped
- ✓ No new dependencies added
- ✓ Tree shaking effective (no unused PrimeNG components)

## Success Criteria

All tests passing means:
- ✅ All 10 UI features visible and functional
- ✅ 45 functional requirements met (from spec.md)
- ✅ No console errors or warnings
- ✅ WCAG 2.1 AA compliance (automated axe scan passes)
- ✅ Mobile responsive on 375px+ screens
- ✅ Performance within constitutional targets
- ✅ Cross-browser compatible (Chrome, Firefox, Safari, Edge)

**Ready for production deployment after:** E2E test suite passes + Manual QA sign-off
