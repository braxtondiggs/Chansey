import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';

import { ButtonModule } from 'primeng/button';
import { FloatLabel } from 'primeng/floatlabel';
import { InputNumberModule } from 'primeng/inputnumber';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TooltipModule } from 'primeng/tooltip';
import { startWith, switchMap } from 'rxjs';

import { MarketLimits, OrderPreview, OrderType, TickerPair, TrailingType } from '@chansey/api-interfaces';

import { ExitConfigComponent } from './exit-config/exit-config.component';

@Component({
  selector: 'app-order-form',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ButtonModule,
    FloatLabel,
    InputNumberModule,
    MessageModule,
    SelectModule,
    SelectButtonModule,
    TooltipModule,
    ExitConfigComponent
  ],
  templateUrl: './order-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OrderFormComponent {
  // Required inputs
  side = input.required<'BUY' | 'SELL'>();
  form = input.required<FormGroup>();
  selectedPair = input.required<TickerPair | null>();
  orderTypeOptions = input.required<{ label: string; value: OrderType; icon: string; description: string }[]>();
  quickAmountOptions = input.required<{ label: string; value: number }[]>();
  trailingTypeOptions = input.required<{ label: string; value: TrailingType }[]>();
  orderPreview = input.required<OrderPreview | null>();
  selectedPercentage = input.required<number | null>();
  isSubmitting = input.required<boolean>();
  hasSufficientBalance = input.required<boolean>();
  fallbackTotal = input.required<number>();
  fallbackNet = input.required<number>();
  marketLimits = input<MarketLimits | null>(null);

  // Outputs
  submitOrder = output<void>();
  percentageChange = output<number | null>();

  // Derived from side
  isBuy = computed(() => this.side() === 'BUY');

  isBelowMinCost = computed(() => {
    const limits = this.marketLimits();
    const pair = this.selectedPair();
    const quantity = this.form().get('quantity')?.value;
    if (!limits?.minCost || !quantity) return false;

    const orderType = this.form().get('type')?.value;
    const customPrice = this.form().get('price')?.value;
    const useLimitPrice = (orderType === OrderType.LIMIT || orderType === OrderType.STOP_LIMIT) && customPrice > 0;
    const price = useLimitPrice ? customPrice : pair?.currentPrice;
    if (!price) return false;

    return quantity * price < limits.minCost;
  });

  // Color theme classes derived from side
  summaryBorderClass = computed(() =>
    this.isBuy() ? 'border-green-200 dark:border-green-800' : 'border-red-200 dark:border-red-800'
  );
  summaryBgClass = computed(() => (this.isBuy() ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'));
  summaryTitleClass = computed(() =>
    this.isBuy() ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'
  );
  labelClass = computed(() => (this.isBuy() ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'));
  valueClass = computed(() => (this.isBuy() ? 'text-green-900 dark:text-green-100' : 'text-red-900 dark:text-red-100'));
  feeClass = computed(() => (this.isBuy() ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'));
  dividerClass = computed(() =>
    this.isBuy() ? 'border-green-200 dark:border-green-700' : 'border-red-200 dark:border-red-700'
  );
  balanceLabelClass = computed(() =>
    this.isBuy() ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
  );

  buttonLabel = computed(() => {
    const pair = this.selectedPair();
    const sideLabel = this.isBuy() ? 'Buy' : 'Sell';
    return pair ? `${sideLabel} ${pair.baseAsset?.symbol?.toUpperCase()}` : sideLabel;
  });

  buttonIcon = computed(() => (this.isBuy() ? 'pi pi-arrow-up' : 'pi pi-arrow-down'));
  buttonSeverity = computed(() => (this.isBuy() ? 'success' : 'danger'));
  summaryTotalLabel = computed(() => (this.isBuy() ? 'Total' : 'Net'));
  summaryHeaderLabel = computed(() => (this.isBuy() ? 'Buy Order Summary' : 'Sell Order Summary'));
  summaryIcon = computed(() => (this.isBuy() ? 'pi pi-arrow-up' : 'pi pi-arrow-down'));

  // Bridge form status into signal system so computed re-evaluates on validity changes
  private formStatus = toSignal(
    toObservable(this.form).pipe(switchMap((f) => f.statusChanges.pipe(startWith(f.status)))),
    { initialValue: 'INVALID' }
  );

  buttonDisabledReason = computed(() => {
    const status = this.formStatus();
    if (!this.selectedPair()) return 'Select a trading pair first';
    if (status === 'INVALID') return 'Please fill in all required fields';
    if (this.isBelowMinCost()) return 'Order value is below the minimum';
    if (this.orderPreview() && !this.hasSufficientBalance()) return 'Insufficient balance';
    return '';
  });

  shouldShowExitConfig = computed(() => {
    const type = this.form().get('type')?.value;
    return type === OrderType.MARKET || type === OrderType.LIMIT;
  });

  exitConfigFormGroup = computed(() => {
    return this.form().get('exitConfig') as FormGroup;
  });

  // Template helper methods
  shouldShowPriceField(): boolean {
    const type = this.form().get('type')?.value;
    return type === OrderType.LIMIT || type === OrderType.STOP_LIMIT;
  }

  shouldShowStopPriceField(): boolean {
    const type = this.form().get('type')?.value;
    return type === OrderType.STOP_LOSS || type === OrderType.STOP_LIMIT;
  }

  shouldShowTrailingFields(): boolean {
    return this.form().get('type')?.value === OrderType.TRAILING_STOP;
  }

  isOcoOrder(): boolean {
    return this.form().get('type')?.value === OrderType.OCO;
  }

  isTakeProfitOnly(): boolean {
    return this.form().get('type')?.value === OrderType.TAKE_PROFIT;
  }

  shouldShowTakeProfitField(): boolean {
    return this.isTakeProfitOnly() || this.isOcoOrder();
  }

  shouldShowStopLossField(): boolean {
    return this.isOcoOrder();
  }

  isFieldInvalid(fieldName: string): boolean {
    const field = this.form().get(fieldName);
    return !!field && field.invalid && (field.dirty || field.touched);
  }

  getFieldError(fieldName: string): string {
    const field = this.form().get(fieldName);
    if (!field?.errors) return '';
    if (field.errors['required']) return 'This field is required';
    if (field.errors['min']) {
      const minValue = field.errors['min'].min;
      if (fieldName === 'quantity' && this.marketLimits()?.minQuantity) {
        const symbol = this.selectedPair()?.baseAsset?.symbol?.toUpperCase() || '';
        return `Minimum is ${minValue} ${symbol}`;
      }
      const formatted = minValue < 0.0001 ? minValue.toFixed(8) : minValue;
      return `Minimum value is ${formatted}`;
    }
    if (field.errors['max']) {
      const maxValue = field.errors['max'].max;
      if (fieldName === 'quantity' && this.marketLimits()?.maxQuantity) {
        const symbol = this.selectedPair()?.baseAsset?.symbol?.toUpperCase() || '';
        return `Maximum is ${maxValue} ${symbol}`;
      }
      return `Maximum value is ${maxValue}`;
    }
    if (field.errors['stepSize']) {
      const step = field.errors['stepSize'].requiredStep;
      if (fieldName === 'quantity') {
        const symbol = this.selectedPair()?.baseAsset?.symbol?.toUpperCase() || '';
        return `Must be in increments of ${step} ${symbol}`;
      }
      if (fieldName === 'price') {
        const symbol = this.selectedPair()?.quoteAsset?.symbol?.toUpperCase() || '';
        return `Must be in increments of ${step} ${symbol}`;
      }
      return `Must be in increments of ${step}`;
    }
    return 'Invalid value';
  }

  countDecimals(value: number): number {
    if (Math.floor(value) === value || !isFinite(value)) return 0;
    const s = String(value);
    if (s.includes('e-')) {
      return parseInt(s.split('e-')[1], 10);
    }
    return s.split('.')[1]?.length || 0;
  }

  onSubmit(): void {
    this.submitOrder.emit();
  }

  onPercentageChange(value: number | null): void {
    this.percentageChange.emit(value);
  }
}
