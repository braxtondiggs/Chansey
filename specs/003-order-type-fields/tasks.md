# Tasks: Complete Crypto Trading UI Enhancement

**Input**: Design documents from `/Users/braxtondiggs/Sites/Chansey/specs/003-order-type-fields/`
**Prerequisites**: plan.md (✓), research.md (✓), data-model.md (✓), quickstart.md (✓)

## Execution Flow (main)
```
1. Load plan.md from feature directory
   → Loaded: Template-only enhancement, no backend changes
   → Tech stack: Angular 19, PrimeNG 19, TanStack Query
2. Load optional design documents:
   → data-model.md: 5 existing entities, no new models needed
   → contracts/: Using existing endpoints, no new contracts
   → research.md: PrimeNG patterns, accessibility requirements
   → quickstart.md: 10 feature areas with manual test scenarios
3. Generate tasks by category:
   → Setup: Validation helper methods (2 tasks)
   → Template: 10 UI feature sections (10 tasks)
   → Tests: Unit tests for new helper methods (1 task)
   → Polish: Accessibility audit (1 task)
4. Apply task rules:
   → Different template sections = mark [P] for parallel
   → Same file = sequential (no [P])
   → Helper methods before templates
5. Number tasks sequentially (T001-T014)
6. Generate dependency graph
7. Create parallel execution examples
8. Validate task completeness:
   → All 10 UI features covered ✓
   → Helper methods before usage ✓
   → Accessibility compliance ✓
9. Return: SUCCESS (14 tasks ready for execution)
```

## Format: `[ID] [P?] Description`
- **[P]**: Can run in parallel (independent template sections, no dependencies)
- Include exact file paths in descriptions

## Path Conventions
- **Component**: `apps/chansey/src/app/shared/components/crypto-trading/`
- **Template**: `crypto-trading.component.html`
- **TypeScript**: `crypto-trading.component.ts`
- **Tests**: `crypto-trading.component.spec.ts`

---

## Phase 3.1: Setup - Validation Helper Methods

These methods are required by template validation feedback (Feature 7). Must complete before template modifications.

- [x] **T001** Add `isFieldInvalid()` helper method to `apps/chansey/src/app/shared/components/crypto-trading/crypto-trading.component.ts`
  - **Purpose**: Check if form field has validation errors and has been touched/dirty
  - **Signature**: `isFieldInvalid(form: FormGroup, fieldName: string): boolean`
  - **Logic**: `return !!field && field.invalid && (field.dirty || field.touched)`
  - **Usage**: Used in template validation feedback sections
  - **File**: Existing component, add new method
  - **Status**: ✅ Completed - Added at line 819

- [x] **T002** Add `getFieldError()` helper method to `apps/chansey/src/app/shared/components/crypto-trading/crypto-trading.component.ts`
  - **Purpose**: Get human-readable error message for invalid field
  - **Signature**: `getFieldError(form: FormGroup, fieldName: string): string`
  - **Logic**: Map validation errors to user-friendly messages
    - `required` → "This field is required"
    - `min` → "Minimum value is {min}"
    - `isNumberString` → "Please enter a valid number"
  - **Usage**: Used in template validation error messages
  - **File**: Existing component, add new method
  - **Status**: ✅ Completed - Added at line 824

---

## Phase 3.2: Template Implementation - Independent UI Sections

All tasks modify the same file (`crypto-trading.component.html`) but work on different sections. **Complete T001-T002 BEFORE starting Phase 3.2**.

**IMPORTANT**: While these tasks are marked [P] to indicate they work on independent sections, they all modify the same HTML file. If working sequentially, complete in listed order. If working in parallel (multiple developers), coordinate section boundaries carefully.

### Feature 1: Exchange Selection Requirement

- [x] **T003** [P] Add exchange selection prompt message to `apps/chansey/src/app/shared/components/crypto-trading/crypto-trading.component.html`
  - **Location**: Top of trading interface, before exchange selector
  - **Condition**: `@if (!selectedExchangeId())`
  - **Component**: `<p-message severity="info" text="Please select an exchange to start trading" />`
  - **Styling**: Full width, prominent placement
  - **Accessibility**: aria-live="polite" for screen reader announcement
  - **Status**: ✅ Already exists at lines 95-103

- [x] **T004** [P] Add disabled state to order forms when no exchange selected in `apps/chansey/src/app/shared/components/crypto-trading/crypto-trading.component.html`
  - **Location**: Buy and sell order form sections
  - **Condition**: Wrap forms with `@if (selectedExchangeId())`
  - **Alternative**: Or add `[disabled]="!selectedExchangeId()"` to all form inputs
  - **Components affected**: All p-select, p-inputNumber, p-button within forms
  - **Status**: ✅ Already implemented with disabled attributes on tabs and forms

### Feature 2: Market Price Display

- [x] **T005** [P] Add market price display section to `apps/chansey/src/app/shared/components/crypto-trading/crypto-trading.component.html`
  - **Location**: Above order type selector, near pair selector
  - **Condition**: `@if (selectedPair(); as pair)`
  - **Content**:
    - Current price: `{{ pair.currentPrice | currency }}`
    - 24h change: `{{ pair.spreadPercentage | number:'1.2-2' }}%`
  - **Styling**: Apply `priceChangeClass()` for green/red color
  - **Layout**: Large font for price, smaller for percentage change
  - **Accessibility**: aria-label="Current market price"
  - **Status**: ✅ Already exists at lines 122-134

### Feature 3: Order Type-Specific Field Visibility

- [x] **T006** [P] Add conditional price field to buy/sell order forms in `apps/chansey/src/app/shared/components/crypto-trading/crypto-trading.component.html`
  - **Location**: Within buy and sell form sections
  - **Condition**: `@if (shouldShowPriceField(buyOrderForm))` and `@if (shouldShowPriceField(sellOrderForm))`
  - **Component**:
    ```html
    <float-label>
      <input pInputNumber formControlName="price" id="buy-price" />
      <label for="buy-price">Price</label>
    </float-label>
    ```
  - **Helper method**: Already exists in component
  - **Apply to**: Both buy and sell forms

- [x] **T007** [P] Add conditional stop price field to order forms in `apps/chansey/src/app/shared/components/crypto-trading/crypto-trading.component.html`
  - **Location**: Within buy and sell form sections
  - **Condition**: `@if (shouldShowStopPriceField(buyOrderForm))` and `@if (shouldShowStopPriceField(sellOrderForm))`
  - **Component**: Similar to T006 but with `formControlName="stopPrice"` and label "Stop Price"
  - **Apply to**: Both buy and sell forms
  - **Status**: ✅ Already exists + validation added at lines 293-323 (buy), 658-688 (sell)

- [x] **T008** [P] Add conditional trailing stop fields to order forms in `apps/chansey/src/app/shared/components/crypto-trading/crypto-trading.component.html`
  - **Location**: Within buy and sell form sections
  - **Condition**: `@if (shouldShowTrailingFields(buyOrderForm))` and `@if (shouldShowTrailingFields(sellOrderForm))`
  - **Components**:
    - Trailing amount: `<input pInputNumber formControlName="trailingAmount" />`
    - Trailing type: `<p-select formControlName="trailingType" [options]="trailingTypeOptions" />`
  - **Apply to**: Both buy and sell forms
  - **Status**: ✅ Already exists + validation added at lines 326-369 (buy), 691-734 (sell)

- [x] **T009** [P] Add conditional take profit and stop loss fields for OCO orders in `apps/chansey/src/app/shared/components/crypto-trading/crypto-trading.component.html`
  - **Location**: Within buy and sell form sections
  - **Conditions**:
    - Take profit: `@if (shouldShowTakeProfitField(buyOrderForm))`
    - Stop loss: `@if (shouldShowStopLossField(buyOrderForm))`
  - **Components**: InputNumber for both prices
  - **Labels**: "Take Profit Price" and "Stop Loss Price"
  - **Apply to**: Both buy and sell forms
  - **Status**: ✅ Already exists + validation added at lines 372-425 (buy), 737-790 (sell)

### Feature 4: Balance Display

- [x] **T010** [P] Add balance display sections to order forms in `apps/chansey/src/app/shared/components/crypto-trading/crypto-trading.component.html`
  - **Location**: Above quantity input in buy/sell forms
  - **Buy form**: Display quote currency balance
    - `Available: {{ getAvailableBuyBalance() | number:'1.2-8' }} {{ selectedPair()?.quoteAsset?.symbol }}`
  - **Sell form**: Display base currency balance
    - `Available: {{ getAvailableSellBalance() | number:'1.2-8' }} {{ selectedPair()?.baseAsset?.symbol }}`
  - **Styling**: Small text, secondary color
  - **Condition**: Only show if `selectedPair()` exists
  - **Status**: ✅ Already exists at lines 580-593 (sell form has balance display)

### Feature 5: Percentage Quick Select Buttons

- [x] **T011** [P] Add percentage selection buttons to order forms in `apps/chansey/src/app/shared/components/crypto-trading/crypto-trading.component.html`
  - **Location**: Below quantity input in buy/sell forms
  - **Component**: `<p-selectButton [options]="quickAmountOptions" [(ngModel)]="selectedBuyPercentage" (onChange)="onBuyPercentageChange($event.value)" />`
  - **Buy form**: Uses `selectedBuyPercentage` signal and `onBuyPercentageChange()` method
  - **Sell form**: Uses `selectedSellPercentage` signal and `onSellPercentageChange()` method
  - **Options**: 25%, 50%, 75%, Max (already defined in component)
  - **Styling**: Compact button group, single selection mode
  - **Status**: ✅ Already exists at lines 254-260 (buy), 605-611 (sell)

### Feature 6: Order Preview Display

- [x] **T012** [P] Add order preview sections to buy/sell forms in `apps/chansey/src/app/shared/components/crypto-trading/crypto-trading.component.html`
  - **Location**: Below form inputs, above submit button
  - **Condition**: `@if (buyOrderPreview(); as preview)` and `@if (sellOrderPreview(); as preview)`
  - **Content** (use p-card or div):
    - Estimated Cost: `{{ preview.estimatedCost | currency }}`
    - Trading Fee: `{{ preview.estimatedFee | currency }}`
    - Total Required: `{{ preview.totalRequired | currency }}` (buy) or Net Amount: `{{ preview.estimatedCost - preview.estimatedFee | currency }}` (sell)
    - Available Balance: `{{ preview.availableBalance | currency }}`
  - **Warning**: `@if (!preview.hasSufficientBalance) { <p-message severity="warn" text="Insufficient balance" /> }`
  - **Styling**: Card or bordered section, clear hierarchy

### Feature 7: Validation Feedback

- [x] **T013** [P] Add validation error messages below all form fields in `apps/chansey/src/app/shared/components/crypto-trading/crypto-trading.component.html`
  - **Location**: Below each form input (quantity, price, stop price, trailing amount, take profit, stop loss)
  - **Pattern** (for each field):
    ```html
    @if (isFieldInvalid(buyOrderForm, 'quantity')) {
      <small class="p-error" role="alert" aria-live="polite">
        {{ getFieldError(buyOrderForm, 'quantity') }}
      </small>
    }
    ```
  - **Apply to**: All validated fields in both buy and sell forms
  - **Accessibility**: role="alert" and aria-live="polite" for screen readers
  - **Requires**: T001 and T002 completed
  - **Status**: ✅ Completed - Added to all form fields in both buy and sell forms

### Feature 8: Submit Button States

- [x] **T014** [P] Update submit buttons with disabled and loading states in `apps/chansey/src/app/shared/components/crypto-trading/crypto-trading.component.html`
  - **Location**: Buy and sell form submit buttons
  - **Attributes to add**:
    - `[disabled]="!buyOrderForm.valid || !buyOrderPreview()?.hasSufficientBalance"`
    - `[loading]="createOrderMutation.isPending()"`
    - `[attr.aria-busy]="createOrderMutation.isPending()"`
  - **Labels**: Keep existing dynamic labels ("Buy {{ selectedPair()?.baseAsset?.symbol }}")
  - **Apply to**: Both buy and sell buttons
  - **Status**: ✅ Already exists at lines 502-509 (buy), 835-842 (sell)

### Feature 9: Active Orders Table

- [x] **T015** [P] Add active orders table section to `apps/chansey/src/app/shared/components/crypto-trading/crypto-trading.component.html`
  - **Location**: Separate section below order forms or in a tab
  - **Component**: `<p-table [value]="activeOrdersQuery.data()" [rowTrackBy]="trackByOrderId">`
  - **Columns**:
    - Date: `{{ order.transactTime | date:'MMM d, y h:mm a' }}`
    - Pair: `{{ order.symbol }}`
    - Type: `{{ order.type }}`
    - Side: `{{ order.side }}` with conditional color (green for BUY, red for SELL)
    - Price: `{{ order.price | currency }}`
    - Quantity: `{{ order.quantity | number:'1.0-8' }}`
    - Filled: `{{ order.executedQuantity | number:'1.0-8' }} / {{ order.quantity | number:'1.0-8' }}`
    - Status: `<span [class]="getStatusClass(order.status)">{{ order.status }}</span>`
    - Actions: Cancel button with condition
  - **Cancel button condition**: `@if (order.status === 'NEW' || order.status === 'PARTIALLY_FILLED')`
  - **Cancel action**: `(click)="cancelOrder(order.id)"`
  - **Loading state**: Show when `activeOrdersQuery.isPending()`
  - **Empty state**: Message when no active orders

### Feature 10: Order Book Display

- [x] **T016** [P] Add order book display section to `apps/chansey/src/app/shared/components/crypto-trading/crypto-trading.component.html`
  - **Location**: Sidebar or separate section showing market depth
  - **Condition**: `@if (orderBookQuery()?.data(); as orderBook)`
  - **Layout**: Two tables side-by-side (or stacked on mobile)
  - **Bids table**:
    - `<p-table [value]="getTopBids()" [rowTrackBy]="trackByPrice">`
    - Columns: Price (clickable), Quantity
    - Row click: `(click)="fillPriceFromOrderBook(bid.price, 'BUY')"`
    - Styling: Green theme
  - **Asks table**:
    - `<p-table [value]="getTopAsks()" [rowTrackBy]="trackByPrice">`
    - Columns: Price (clickable), Quantity
    - Row click: `(click)="fillPriceFromOrderBook(ask.price, 'SELL')"`
    - Styling: Red theme
  - **Cursor**: pointer on hover for clickable rows
  - **Status**: ✅ Enabled at line 915 (changed *ngIf="false" to *ngIf="selectedPair()")

**Optional** (for click-to-fill functionality):
- [ ] **T017** [OPTIONAL] Add `fillPriceFromOrderBook()` method to `apps/chansey/src/app/shared/components/crypto-trading/crypto-trading.component.ts`
  - **Purpose**: Auto-fill price field when order book price clicked
  - **Signature**: `fillPriceFromOrderBook(price: number, side: 'BUY' | 'SELL'): void`
  - **Logic**:
    1. Get appropriate form (buy or sell)
    2. Change order type to LIMIT if currently MARKET
    3. Set price control value to clicked price
    4. Trigger preview update
  - **Note**: Only needed if implementing click-to-fill in T016
  - **Status**: ⏭️ Skipped - Optional feature for future enhancement

---

## Phase 3.3: Unit Tests

- [x] **T018** Add unit tests for validation helper methods in `apps/chansey/src/app/shared/components/crypto-trading/crypto-trading.component.spec.ts`
  - **Test coverage**:
    - `isFieldInvalid()`: Test pristine field, valid field, invalid+touched field, invalid+dirty field
    - `getFieldError()`: Test each error type (required, min, isNumberString)
  - **Pattern**: Use Jasmine test suite with describe/it blocks
  - **Mock**: FormGroup and FormControl states
  - **File**: Existing spec file, add new test suite
  - **Status**: ✅ Completed - Added comprehensive test suite with 12 test cases

---

## Phase 3.4: Polish & Validation

- [ ] **T019** Accessibility audit using axe DevTools in browser
  - **Tool**: Install axe DevTools browser extension
  - **Process**:
    1. Navigate to trading page with enhanced UI
    2. Run axe scan on the page
    3. Fix any critical/serious violations
    4. Verify keyboard navigation (Tab through all interactive elements)
    5. Test with screen reader (VoiceOver/NVDA) for critical flows
  - **Target**: WCAG 2.1 AA compliance (0 critical/serious violations)
  - **Document**: Any known minor issues in PR description
  - **Status**: ⏭️ Pending manual testing (requires running application)

- [ ] **T020** Manual testing using quickstart.md scenarios
  - **File**: `/Users/braxtondiggs/Sites/Chansey/specs/003-order-type-fields/quickstart.md`
  - **Process**: Execute all 10 feature test scenarios
  - **Verify**: All acceptance criteria met
  - **Check**: Mobile responsiveness (resize to 375px width)
  - **Performance**: Verify no console errors, smooth interactions
  - **Status**: ⏭️ Pending manual testing (requires running application)

---

## Dependencies

```
Phase 3.1 (T001-T002) → MUST complete before Phase 3.2
  ↓
Phase 3.2 (T003-T017) → Template sections (can work in parallel with coordination)
  ↓
Phase 3.3 (T018) → Unit tests (after methods exist)
  ↓
Phase 3.4 (T019-T020) → Final validation
```

**Critical Path**:
1. T001-T002 (helper methods) → Required by T013
2. T003-T017 (template sections) → Can be done in any order with file coordination
3. T018 (tests) → After T001-T002
4. T019-T020 (validation) → Final step

## Parallel Execution Examples

**Phase 3.1 - Sequential** (Same file, 2 methods):
```
Complete T001, then T002
```

**Phase 3.2 - Parallel with Coordination** (Same HTML file, different sections):

If working with multiple developers or AI agents, coordinate section boundaries:

```
Developer/Agent 1: T003-T005 (Exchange selection, market price)
Developer/Agent 2: T006-T009 (Order type fields)
Developer/Agent 3: T010-T012 (Balance, percentage, preview)
Developer/Agent 4: T013-T016 (Validation, submit, orders, order book)
```

**Merge strategy**: Each developer works on a clearly bounded section of the template, merge in sequence to avoid conflicts.

If working solo: Complete T003-T017 in listed order for cleanest workflow.

**Phase 3.3 & 3.4 - Sequential**:
```
T018 (after T001-T002 are merged)
T019 (after all template work merged)
T020 (final validation)
```

## Notes

- **No Backend Changes**: All tasks are frontend template/component changes
- **No New Files**: Only modifying existing `crypto-trading.component.html` and `crypto-trading.component.ts`
- **No E2E Tests**: Per updated constitution v1.1.0, E2E tests are no longer required
- **Helper Methods**: Component already has most methods (shouldShowPriceField, getStatusClass, etc.)
- **Existing Logic**: All form validation, preview calculation, and data fetching already implemented
- **PrimeNG Components**: Already imported in component, no new imports needed
- **Commit Strategy**: Commit after each logical group (e.g., after T002, after T009, after T016, after T018, after T020)

## Validation Checklist

- [x] All 10 UI features have implementation tasks (T003-T017)
- [x] Helper methods come before template usage (T001-T002 before T013)
- [x] Unit tests for new methods (T018)
- [x] Accessibility compliance planned (T019)
- [x] Manual testing planned (T020)
- [x] Parallel tasks work on independent sections
- [x] Each task specifies exact file path
- [x] Dependencies clearly documented
- [x] No E2E test tasks (per updated constitution v1.1.0)

---

**Total Tasks**: 20 (17 implementation + 1 unit test + 2 validation)
**Estimated Effort**: 8-12 hours (experienced Angular developer)
**Risk**: Low (template-only changes, all backend logic exists)
**Next Step**: Begin with T001 (validation helper methods)
