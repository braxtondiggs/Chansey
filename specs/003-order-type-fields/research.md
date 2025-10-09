# Phase 0: Research & Technology Decisions

## Overview
This document captures research findings and technology decisions for enhancing the crypto-trading component template. Since all backend functionality and component logic already exists, this research focuses on UI patterns, PrimeNG component usage, and Angular template best practices.

## Research Areas

### 1. PrimeNG Component Patterns

#### Decision
Use PrimeNG components exclusively for all new UI elements to maintain consistency with the existing application design system.

#### Components Required
- **p-select**: Exchange selection dropdown with custom item templates for status indicators
- **p-inputNumber**: Numeric inputs for quantity, price, stop price, trailing amount with decimal precision
- **p-selectButton**: Quick percentage selection (25%, 50%, 75%, Max) with single selection mode
- **p-button**: Submit buttons with loading states and disabled states
- **p-table**: Order book display (bids/asks) and active orders table with sortable columns
- **p-message**: Exchange selection prompt and validation error messages
- **p-card**: Grouping containers for order preview sections and balance displays
- **FloatLabel**: Floating label inputs for better UX on all form fields
- **p-toast**: Success/error notifications for order operations (already implemented)

#### Rationale
- **Consistency**: Application already uses PrimeNG throughout (verified in crypto-trading.component.ts imports)
- **Responsive**: PrimeNG components are mobile-first with built-in responsive behavior
- **Accessibility**: PrimeNG provides ARIA attributes and keyboard navigation out of the box
- **Theming**: Components respect the application's dark mode theme automatically
- **Bundle Size**: Already part of the application bundle, no additional dependencies

#### Alternatives Considered
- **Custom Components**: Rejected because it would break design consistency and require additional testing
- **Material Design**: Rejected because the application standardized on PrimeNG
- **Headless UI**: Rejected because it would require custom styling and accessibility work

### 2. Conditional Template Display (*ngIf Patterns)

#### Decision
Use *ngIf with component helper methods for order type-specific field visibility to maintain separation of concerns and testability.

#### Pattern
```html
<!-- Example: Show price field for Limit and Stop-Limit orders -->
<div *ngIf="shouldShowPriceField(buyOrderForm)">
  <float-label>
    <input pInputNumber formControlName="price" id="buy-price" />
    <label for="buy-price">Price</label>
  </float-label>
</div>
```

#### Rationale
- **Maintainability**: Logic encapsulated in TypeScript methods, easy to test and modify
- **Readability**: Template remains clean without complex inline expressions
- **Reusability**: Helper methods can be used for both buy and sell forms
- **Type Safety**: TypeScript compiler catches errors in helper method logic
- **Existing Pattern**: Component already has helper methods (shouldShowPriceField(), shouldShowStopPriceField(), etc.)

#### Alternatives Considered
- **Inline Expressions**: `*ngIf="buyOrderForm.get('type')?.value === OrderType.LIMIT"` - Rejected for complexity and duplication
- **ngSwitch**: Rejected because multiple fields can show simultaneously (e.g., Stop-Limit needs both fields)
- **Structural Directives**: Custom directive - Rejected as over-engineering for simple visibility logic

### 3. Form Validation Feedback

#### Decision
Use PrimeNG's validation message pattern with Angular's form validation state and custom error message methods.

#### Pattern
```html
<div class="field">
  <float-label>
    <input pInputNumber formControlName="quantity" id="buy-quantity" />
    <label for="buy-quantity">Quantity</label>
  </float-label>
  @if (isFieldInvalid(buyOrderForm, 'quantity')) {
    <small class="p-error">{{ getFieldError(buyOrderForm, 'quantity') }}</small>
  }
</div>
```

#### Error Message Method
```typescript
isFieldInvalid(form: FormGroup, fieldName: string): boolean {
  const field = form.get(fieldName);
  return !!field && field.invalid && (field.dirty || field.touched);
}

getFieldError(form: FormGroup, fieldName: string): string {
  const field = form.get(fieldName);
  if (field?.hasError('required')) return 'This field is required';
  if (field?.hasError('min')) return `Minimum value is ${field.getError('min').min}`;
  // ... more error types
}
```

#### Rationale
- **User Experience**: Immediate feedback when field loses focus (dirty/touched check)
- **Accessibility**: Error messages announced to screen readers via aria-describedby
- **Consistency**: Matches PrimeNG validation pattern used elsewhere in the application
- **Specificity**: Custom messages explain exactly what's wrong (not generic "invalid")

#### Alternatives Considered
- **Form-level Errors**: Rejected because field-level errors provide better UX
- **Third-party Validation**: @rxweb/reactive-form-validators - Rejected to avoid additional dependencies
- **Template-driven Validation**: Rejected because component already uses reactive forms

### 4. Real-time Preview Updates

#### Decision
Use Angular signals with TanStack Query mutations for reactive order preview updates.

#### Pattern (Already Implemented in Component)
```typescript
// Signals for preview data (already exist)
buyOrderPreview = signal<OrderPreview | null>(null);
sellOrderPreview = signal<OrderPreview | null>(null);

// Mutation for preview (already exists)
previewOrderMutation = this.tradingService.usePreviewOrder();

// Form value change subscription (already exists)
this.buyOrderForm.get('quantity')?.valueChanges
  .pipe(takeUntil(this.destroy$))
  .subscribe(() => this.calculateOrderTotalWithPreview('BUY'));
```

#### Template Display Pattern
```html
@if (buyOrderPreview(); as preview) {
  <div class="preview-section">
    <div class="preview-row">
      <span>Estimated Cost:</span>
      <span>{{ preview.estimatedCost | currency }}</span>
    </div>
    <div class="preview-row">
      <span>Trading Fee:</span>
      <span>{{ preview.estimatedFee | currency }}</span>
    </div>
    @if (!preview.hasSufficientBalance) {
      <p-message severity="warn" text="Insufficient balance"></p-message>
    }
  </div>
}
```

#### Rationale
- **Reactivity**: Angular signals provide efficient change detection for preview updates
- **Real-time**: TanStack Query automatically re-fetches on form changes with debouncing
- **Type Safety**: OrderPreview interface ensures consistent data structure
- **Existing Infrastructure**: Component already has preview signals and mutation logic

#### Alternatives Considered
- **RxJS Observables**: Rejected because the component uses Angular signals pattern
- **Manual Calculations**: Rejected because server-side preview provides accurate exchange fees
- **Polling**: Rejected because form change subscriptions provide better UX

### 5. Order Book Display

#### Decision
Use PrimeNG Table with click handlers for bid/ask price auto-fill functionality.

#### Pattern
```html
<p-table [value]="getTopBids()" [rowTrackBy]="trackByPrice">
  <ng-template #header>
    <tr>
      <th>Price</th>
      <th>Quantity</th>
    </tr>
  </ng-template>
  <ng-template #body let-bid>
    <tr (click)="fillPriceFromOrderBook(bid.price, 'BUY')" class="cursor-pointer hover:bg-surface-hover">
      <td>{{ bid.price | currency }}</td>
      <td>{{ bid.quantity | number:'1.0-8' }}</td>
    </tr>
  </ng-template>
</p-table>
```

#### Rationale
- **Interactivity**: Click-to-fill is intuitive for traders
- **Performance**: trackBy function prevents unnecessary re-renders
- **Visual Feedback**: Cursor and hover states indicate clickable rows
- **Data Source**: Component already has getTopBids() and getTopAsks() methods

#### Alternatives Considered
- **Custom Table**: Rejected to maintain PrimeNG consistency
- **Button per Row**: Rejected for cluttered UI
- **Double-click**: Rejected for poor mobile UX

### 6. Accessibility Patterns

#### Decision
Implement WCAG 2.1 AA compliance through semantic HTML, ARIA attributes, keyboard navigation, and focus management.

#### Key Patterns

**Form Labels**
```html
<float-label>
  <input pInputNumber
         formControlName="quantity"
         id="buy-quantity"
         aria-describedby="buy-quantity-error"
         [attr.aria-invalid]="isFieldInvalid(buyOrderForm, 'quantity')" />
  <label for="buy-quantity">Quantity</label>
</float-label>
<small id="buy-quantity-error" class="p-error" role="alert" aria-live="polite">
  {{ getFieldError(buyOrderForm, 'quantity') }}
</small>
```

**Button States**
```html
<p-button
  label="Buy {{ selectedPair()?.baseAsset?.symbol }}"
  [disabled]="!buyOrderForm.valid || !buyOrderPreview()?.hasSufficientBalance"
  [loading]="createOrderMutation.isPending()"
  [attr.aria-busy]="createOrderMutation.isPending()"
  aria-label="Place buy order" />
```

**Table Accessibility**
```html
<p-table
  [value]="activeOrdersQuery.data()"
  [caption]="'Active trading orders'"
  role="region"
  aria-label="Active orders table">
```

#### Rationale
- **Compliance**: WCAG 2.1 AA is a constitutional requirement
- **Screen Readers**: aria-live regions announce validation errors and loading states
- **Keyboard Navigation**: All interactive elements reachable via Tab, activated via Enter/Space
- **Focus Management**: Focus trapped in modals, moved to error messages on validation failure

#### Alternatives Considered
- **WCAG AAA**: Rejected as beyond constitutional requirement (AA is sufficient)
- **Manual Testing Only**: Rejected because automated tools catch 40-60% of issues
- **Third-party A11y Library**: Rejected because PrimeNG already provides most ARIA attributes

## Performance Considerations

### Bundle Size Impact
- **Estimated Addition**: 3-5KB gzipped (template markup only, no new dependencies)
- **Tree Shaking**: No new component imports needed (all PrimeNG components already imported)
- **Lazy Loading**: Component already part of app routes, no additional lazy loading needed

### Runtime Performance
- **Change Detection**: Signals provide OnPush-compatible reactivity for preview updates
- **Table Rendering**: trackBy functions prevent unnecessary DOM manipulations
- **Form Subscriptions**: Debounced via TanStack Query's mutation throttling (500ms default)
- **Order Book Updates**: Component should use RxJS distinctUntilChanged to prevent flicker

### Mobile Performance
- **Responsive Grid**: PrimeNG grid system handles mobile layouts automatically
- **Touch Targets**: All interactive elements meet 44x44px minimum touch target size
- **Virtual Scrolling**: Consider p-virtualScroller if active orders table exceeds 50 rows

## Integration Points

### Existing Component Methods (No Changes Needed)
- `shouldShowPriceField(form)` - Already exists
- `shouldShowStopPriceField(form)` - Already exists
- `shouldShowTrailingFields(form)` - Already exists
- `shouldShowTakeProfitField(form)` - Already exists
- `shouldShowStopLossField(form)` - Already exists
- `getStatusClass(status)` - Already exists
- `priceChangeClass()` - Already exists
- `getTopBids()` - Already exists
- `getTopAsks()` - Already exists
- `getAvailableBuyBalance()` - Already exists
- `getAvailableSellBalance()` - Already exists
- `calculateMaxBuyQuantityWithFees()` - Already exists
- `setQuantityPercentage(side, percentage)` - Already exists

### New Methods Required
- `isFieldInvalid(form, fieldName)` - Check if field has validation errors
- `getFieldError(form, fieldName)` - Get human-readable error message
- `fillPriceFromOrderBook(price, side)` - Auto-fill price field from order book click (optional)

## Testing Strategy

### Unit Tests (Jasmine/Karma)
- Helper method tests already exist for order type visibility logic
- Add tests for new `isFieldInvalid` and `getFieldError` methods
- Template snapshot tests for visual regression

### E2E Tests (Cypress)
- Order type field visibility scenarios (6 order types × 2 forms = 12 tests)
- Order preview display and real-time updates (3 tests)
- Active orders table display and cancel functionality (4 tests)
- Market price display (2 tests)
- Validation feedback (5 tests)
- Submit button states (4 tests)
- Exchange selection (3 tests)
- Balance display (4 tests)
- Percentage quick select (4 tests)
- Order book interaction (3 tests)
**Total**: ~44 E2E test scenarios

### Accessibility Testing
- axe-core automated scan (via Cypress axe plugin)
- Manual keyboard navigation testing
- Screen reader testing (VoiceOver/NVDA) for critical flows

## Summary

All technical decisions align with:
- **Constitution**: PrimeNG components, WCAG 2.1 AA, mobile-first, TanStack Query patterns
- **Existing Codebase**: No new dependencies, uses established patterns, extends existing component
- **Performance**: Minimal bundle impact, reactive signals, efficient change detection
- **Testability**: E2E tests cover all user scenarios, accessible to automated tools

**Next Phase**: Proceed to Phase 1 (Design & Contracts) to document data model and create quickstart scenarios.
