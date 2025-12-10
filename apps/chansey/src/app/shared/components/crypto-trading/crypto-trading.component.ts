import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';

import { MessageService } from 'primeng/api';
import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { FloatLabel } from 'primeng/floatlabel';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TableModule } from 'primeng/table';
import { TabsModule } from 'primeng/tabs';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { debounceTime, Subject, takeUntil } from 'rxjs';

import {
  Exchange,
  OrderPreview,
  OrderSide,
  OrderStatus,
  OrderType,
  PlaceOrderRequest,
  TickerPair,
  TrailingType
} from '@chansey/api-interfaces';

import { AuthService } from '../../services';
import { Balance, CryptoTradingService } from '../../services/crypto-trading.service';
import { ExchangeService } from '../../services/exchange.service';

@Component({
  selector: 'app-crypto-trading',
  standalone: true,
  imports: [
    CommonModule,
    FloatLabel,
    FormsModule,
    ReactiveFormsModule,
    AvatarModule,
    ButtonModule,
    CardModule,
    InputNumberModule,
    SelectModule,
    SelectButtonModule,
    TabsModule,
    TableModule,
    ToastModule,
    TooltipModule
  ],
  templateUrl: './crypto-trading.component.html'
})
export class CryptoTradingComponent implements OnInit, OnDestroy {
  private readonly authService = inject(AuthService);
  private readonly tradingService = inject(CryptoTradingService);
  private readonly exchangeService = inject(ExchangeService);
  private readonly fb = inject(FormBuilder);
  private readonly messageService = inject(MessageService);
  private readonly destroy$ = new Subject<void>();
  private readonly previewSubject$ = new Subject<'BUY' | 'SELL'>();

  // Reactive state
  selectedPairValue = signal<string | null>(null);
  selectedExchangeId = signal<string | null>(null);
  activeOrderTab = signal<string>('buy');
  showActiveOrders = signal<boolean>(true);
  selectedBuyPercentage = signal<number | null>(null);
  selectedSellPercentage = signal<number | null>(null);
  buyOrderPreview = signal<OrderPreview | null>(null);
  sellOrderPreview = signal<OrderPreview | null>(null);

  // Computed symbol for order book query
  selectedSymbol = computed(() => {
    const pairSymbol = this.selectedPairValue();
    const pairs = this.tradingPairsQuery.data();

    if (!pairSymbol || !pairs) {
      return null;
    }

    const foundPair = pairs.find((pair) => pair.symbol.toUpperCase() === pairSymbol.toUpperCase());
    return foundPair?.symbol || null;
  });

  // Forms
  buyOrderForm!: FormGroup;
  sellOrderForm!: FormGroup;

  // Query hooks
  userQuery = this.authService.useUser();
  exchangeQuery = this.exchangeService.useSupportedExchanges();
  tradingPairsQuery = this.tradingService.useTradingPairs(this.selectedExchangeId);
  balancesQuery = this.tradingService.useBalances();
  activeOrdersQuery = this.tradingService.useActiveOrders();
  orderBookQuery = this.tradingService.useOrderBook(this.selectedSymbol, this.selectedExchangeId);

  // Mutations
  createOrderMutation = this.tradingService.useCreateOrder();
  previewOrderMutation = this.tradingService.usePreviewOrder();
  cancelOrderMutation = this.tradingService.useCancelOrder();

  // Computed values
  selectedPair = computed(() => {
    const pairSymbol = this.selectedPairValue();
    const pairs = this.tradingPairsQuery.data();

    if (!pairSymbol || !pairs) {
      return null;
    }

    // Find pair by comparing uppercase symbols since tradingPairOptions uses toUpperCase()
    const foundPair = pairs.find((pair) => pair.symbol.toUpperCase() === pairSymbol.toUpperCase());
    return foundPair || null;
  });

  // Get the exchange key ID for the selected exchange
  selectedExchangeKeyId = computed(() => {
    const exchangeId = this.selectedExchangeId();
    const userExchanges = this.userQuery.data()?.exchanges;

    if (!exchangeId || !userExchanges) return null;

    const userExchange = userExchanges.find((ue: any) => ue.exchangeId === exchangeId);
    return userExchange?.id || null;
  });

  exchangeOptions = computed(() => {
    const supportedExchanges = this.exchangeQuery.data();
    const userExchanges = this.userQuery.data()?.exchanges;

    return supportedExchanges?.map((exchange: Exchange) => {
      // Find matching user exchange to check if it's active
      const userExchange = userExchanges?.find((ue: any) => ue.exchangeId === exchange.id);
      const isActive = userExchange?.isActive || false;

      return {
        label: exchange.name,
        value: exchange.id,
        image: exchange.image,
        status: isActive ? 'connected' : 'disconnected',
        pairCount: exchange.tickerPairsCount || 0
      };
    });
  });

  tradingPairOptions = computed(() => {
    const pairs = this.tradingPairsQuery.data() || [];
    const selectedExchange = this.selectedExchangeId();

    return pairs.map((pair: TickerPair) => ({
      label: `${pair.baseAsset?.symbol}/${pair.quoteAsset?.symbol}`.toUpperCase(),
      value: pair.symbol.toUpperCase(),
      exchangeId: selectedExchange || pair.exchange?.id,
      price: pair.currentPrice,
      change24h: pair.spreadPercentage || 0
    }));
  });

  // Supported order types (will be updated from preview response)
  supportedOrderTypes = signal<OrderType[]>([OrderType.MARKET, OrderType.LIMIT]);

  orderTypeOptions = computed(() => {
    const supported = this.supportedOrderTypes();
    return this.enhancedOrderTypeOptions.filter((opt) => supported.includes(opt.value));
  });

  enhancedOrderTypeOptions = [
    {
      label: 'Market',
      value: OrderType.MARKET,
      icon: 'pi pi-bolt',
      description: 'Execute immediately at current market price'
    },
    {
      label: 'Limit',
      value: OrderType.LIMIT,
      icon: 'pi pi-list',
      description: 'Execute only at your specified price or better'
    },
    {
      label: 'Stop Loss',
      value: OrderType.STOP_LOSS,
      icon: 'pi pi-shield',
      description: 'Market order triggered when price hits stop price'
    },
    {
      label: 'Stop Limit',
      value: OrderType.STOP_LIMIT,
      icon: 'pi pi-cog',
      description: 'Limit order triggered when price hits stop price'
    },
    {
      label: 'Trailing Stop',
      value: OrderType.TRAILING_STOP,
      icon: 'pi pi-chart-line',
      description: 'Stop order that automatically adjusts with favorable price movements'
    },
    {
      label: 'Take Profit',
      value: OrderType.TAKE_PROFIT,
      icon: 'pi pi-check-circle',
      description: 'Limit order to close position when target profit is reached'
    },
    {
      label: 'OCO',
      value: OrderType.OCO,
      icon: 'pi pi-arrows-h',
      description: 'One-Cancels-Other: Take profit and stop loss pair'
    }
  ];

  quickAmountOptions = [
    { label: '25%', value: 25 },
    { label: '50%', value: 50 },
    { label: '75%', value: 75 },
    { label: 'Max', value: 100 }
  ];

  trailingTypeOptions = [
    { label: 'Amount', value: TrailingType.AMOUNT },
    { label: 'Percentage', value: TrailingType.PERCENTAGE }
  ];

  // Auto-select the first connected exchange when available
  private shouldAutoSelect = computed(() => {
    const exchanges = this.exchangeOptions();
    const currentSelection = this.selectedExchangeId();

    if (!exchanges || exchanges.length === 0 || currentSelection) {
      return null;
    }

    const connectedExchanges = exchanges.filter((ex) => ex.status === 'connected');
    return connectedExchanges.length > 0 ? connectedExchanges[0] : null;
  });

  constructor() {
    // Watch for auto-selection opportunities
    effect(() => {
      const exchangeToSelect = this.shouldAutoSelect();
      if (exchangeToSelect) {
        this.selectedExchangeId.set(exchangeToSelect.value);
      }
    });
  }

  ngOnInit() {
    this.initializeForms();
    this.setupFormSubscriptions();
    this.setupPreviewDebounce();
  }

  private setupPreviewDebounce() {
    this.previewSubject$
      .pipe(debounceTime(300), takeUntil(this.destroy$))
      .subscribe((side) => this.executePreview(side));
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private initializeForms() {
    this.buyOrderForm = this.fb.group({
      type: [OrderType.MARKET, Validators.required],
      quantity: [null, [Validators.required, Validators.min(0.00000001)]],
      price: [null],
      stopPrice: [null],
      trailingAmount: [null],
      trailingType: [TrailingType.AMOUNT],
      takeProfitPrice: [null],
      stopLossPrice: [null]
    });

    this.sellOrderForm = this.fb.group({
      type: [OrderType.MARKET, Validators.required],
      quantity: [null, [Validators.required, Validators.min(0.00000001)]],
      price: [null],
      stopPrice: [null],
      trailingAmount: [null],
      trailingType: [TrailingType.AMOUNT],
      takeProfitPrice: [null],
      stopLossPrice: [null]
    });
  }

  private setupFormSubscriptions() {
    // Update validators when order type changes for buy form
    this.buyOrderForm
      .get('type')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe((type) => {
        this.updateFormValidators(this.buyOrderForm, type);
        this.triggerPreview('BUY');
      });

    // Update validators when order type changes for sell form
    this.sellOrderForm
      .get('type')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe((type) => {
        this.updateFormValidators(this.sellOrderForm, type);
        this.triggerPreview('SELL');
      });

    // Preview order when quantity changes
    this.buyOrderForm
      .get('quantity')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe(() => this.triggerPreview('BUY'));

    this.sellOrderForm
      .get('quantity')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe(() => this.triggerPreview('SELL'));

    // Preview order when price changes (for limit orders)
    this.buyOrderForm
      .get('price')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe(() => this.triggerPreview('BUY'));

    this.sellOrderForm
      .get('price')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe(() => this.triggerPreview('SELL'));
  }

  private updateFormValidators(form: FormGroup, type: OrderType) {
    const controls = ['price', 'stopPrice', 'trailingAmount', 'takeProfitPrice', 'stopLossPrice'];
    controls.forEach((ctrl) => {
      form.get(ctrl)?.clearValidators();
    });

    if (type === OrderType.LIMIT || type === OrderType.STOP_LIMIT) {
      form.get('price')?.setValidators([Validators.required, Validators.min(0.00000001)]);
    }
    if (type === OrderType.STOP_LOSS || type === OrderType.STOP_LIMIT) {
      form.get('stopPrice')?.setValidators([Validators.required, Validators.min(0.00000001)]);
    }
    if (type === OrderType.TRAILING_STOP) {
      form.get('trailingAmount')?.setValidators([Validators.required, Validators.min(0.00000001)]);
    }
    if (type === OrderType.TAKE_PROFIT) {
      form.get('takeProfitPrice')?.setValidators([Validators.required, Validators.min(0.00000001)]);
    }
    if (type === OrderType.OCO) {
      form.get('takeProfitPrice')?.setValidators([Validators.required, Validators.min(0.00000001)]);
      form.get('stopLossPrice')?.setValidators([Validators.required, Validators.min(0.00000001)]);
    }

    controls.forEach((ctrl) => form.get(ctrl)?.updateValueAndValidity());
  }

  onPairChange(event: { value: string }) {
    const symbol = event.value;
    this.selectedPairValue.set(symbol);

    const pair = this.tradingPairsQuery.data()?.find((p) => p.symbol.toUpperCase() === symbol.toUpperCase());
    if (pair) {
      this.tradingService.setSelectedPair(pair);
      // Trigger preview to get supported order types
      this.triggerPreview('BUY');
    }
  }

  /**
   * Build a PlaceOrderRequest from form data
   */
  private buildOrderRequest(side: 'BUY' | 'SELL'): PlaceOrderRequest | null {
    const form = side === 'BUY' ? this.buyOrderForm : this.sellOrderForm;
    const pair = this.selectedPair();
    const exchangeKeyId = this.selectedExchangeKeyId();

    if (!pair || !exchangeKeyId) return null;

    const formValue = form.value;

    const request: PlaceOrderRequest = {
      exchangeKeyId,
      symbol: pair.symbol,
      side: side === 'BUY' ? OrderSide.BUY : OrderSide.SELL,
      orderType: formValue.type,
      quantity: formValue.quantity || 0
    };

    // Add conditional fields based on order type
    if (formValue.price) request.price = formValue.price;
    if (formValue.stopPrice) request.stopPrice = formValue.stopPrice;
    if (formValue.trailingAmount) {
      request.trailingAmount = formValue.trailingAmount;
      request.trailingType = formValue.trailingType;
    }
    if (formValue.takeProfitPrice) request.takeProfitPrice = formValue.takeProfitPrice;
    if (formValue.stopLossPrice) request.stopLossPrice = formValue.stopLossPrice;

    return request;
  }

  onSubmitOrder(side: 'BUY' | 'SELL') {
    const form = side === 'BUY' ? this.buyOrderForm : this.sellOrderForm;

    if (!form.valid) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Validation Error',
        detail: 'Please fill in all required fields'
      });
      return;
    }

    const orderRequest = this.buildOrderRequest(side);
    if (!orderRequest) {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Please select an exchange and trading pair'
      });
      return;
    }

    this.createOrderMutation.mutate(orderRequest, {
      onSuccess: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Order Placed',
          detail: `${side} order placed successfully`
        });
        form.reset({ type: OrderType.MARKET, trailingType: TrailingType.AMOUNT });
        if (side === 'BUY') {
          this.buyOrderPreview.set(null);
          this.selectedBuyPercentage.set(null);
        } else {
          this.sellOrderPreview.set(null);
          this.selectedSellPercentage.set(null);
        }
      },
      onError: (error: Error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Order Failed',
          detail: error.message || 'Failed to place order'
        });
      }
    });
  }

  cancelOrder(orderId: string) {
    this.cancelOrderMutation.mutate(orderId, {
      onSuccess: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Order Cancelled',
          detail: 'Order cancelled successfully'
        });
      },
      onError: (error: any) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Cancellation Failed',
          detail: error.message || 'Failed to cancel order'
        });
      }
    });
  }

  refreshActiveOrders() {
    // Trigger refetch of active orders
  }

  /**
   * Trigger order preview with debouncing (300ms)
   */
  private triggerPreview(side: 'BUY' | 'SELL'): void {
    this.previewSubject$.next(side);
  }

  /**
   * Execute the actual preview API call (called after debounce)
   */
  private executePreview(side: 'BUY' | 'SELL'): void {
    const form = side === 'BUY' ? this.buyOrderForm : this.sellOrderForm;
    const quantity = form.get('quantity')?.value;

    // Only preview if we have a valid quantity
    if (!quantity || quantity <= 0) return;

    const orderRequest = this.buildOrderRequest(side);
    if (!orderRequest) return;

    this.previewOrderMutation.mutate(orderRequest, {
      onSuccess: (preview) => {
        if (side === 'BUY') {
          this.buyOrderPreview.set(preview);
        } else {
          this.sellOrderPreview.set(preview);
        }

        // Update supported order types if provided
        if (preview.supportedOrderTypes) {
          this.supportedOrderTypes.set(preview.supportedOrderTypes);
        }
      },
      onError: (error: any) => {
        console.warn('Order preview failed:', error.message);
      }
    });
  }

  /**
   * Get order total from preview or calculate fallback
   */
  calculateOrderTotal(side: 'BUY' | 'SELL'): number {
    const preview = side === 'BUY' ? this.buyOrderPreview() : this.sellOrderPreview();
    if (preview) return preview.estimatedCost;

    // Fallback calculation
    const form = side === 'BUY' ? this.buyOrderForm : this.sellOrderForm;
    const pair = this.selectedPair();

    if (!pair) return 0;

    const quantity = form.get('quantity')?.value || 0;
    const orderType = form.get('type')?.value;
    const price =
      orderType === OrderType.MARKET ? pair.currentPrice || 0 : form.get('price')?.value || pair.currentPrice || 0;

    return quantity * price;
  }

  calculateOrderFees(side: 'BUY' | 'SELL'): number {
    const preview = side === 'BUY' ? this.buyOrderPreview() : this.sellOrderPreview();
    if (preview) return preview.estimatedFee;

    // Fallback: estimate 0.1% fee
    return this.calculateOrderTotal(side) * 0.001;
  }

  /**
   * Get fee rate from preview or default
   */
  getFeeRate(side: 'BUY' | 'SELL'): number {
    const preview = side === 'BUY' ? this.buyOrderPreview() : this.sellOrderPreview();
    return preview?.feeRate || 0.001;
  }

  calculateBuyOrderTotalWithFees(): number {
    const preview = this.buyOrderPreview();
    if (preview) return preview.totalRequired;
    return this.calculateOrderTotal('BUY') + this.calculateOrderFees('BUY');
  }

  calculateSellOrderNetAmount(): number {
    const preview = this.sellOrderPreview();
    if (preview) return preview.estimatedCost - preview.estimatedFee;
    return this.calculateOrderTotal('SELL') - this.calculateOrderFees('SELL');
  }

  getBuyBalance(): Balance | undefined {
    const pair = this.selectedPair();
    const balances = this.balancesQuery.data();
    if (!pair || !balances) return undefined;
    return balances.find((b) => b.coin.id === pair.quoteAsset?.id);
  }

  getSellBalance(): Balance | undefined {
    const pair = this.selectedPair();
    const balances = this.balancesQuery.data();
    if (!pair || !balances) return undefined;
    return balances.find((b) => b.coin.id === pair.baseAsset?.id);
  }

  getAvailableBuyBalance(): number {
    const balance = this.getBuyBalance();
    if (!balance) return 0;

    const feeRate = this.getFeeRate('BUY');
    return balance.available * (1 - feeRate);
  }

  getAvailableSellBalance(): number {
    const balance = this.getSellBalance();
    return balance?.available || 0;
  }

  calculateMaxBuyQuantity(): number {
    const availableBalance = this.getAvailableBuyBalance();
    const pair = this.selectedPair();

    if (!pair?.currentPrice || availableBalance <= 0) return 0;
    return availableBalance / pair.currentPrice;
  }

  getTopBids() {
    return this.orderBookQuery.data()?.bids.slice(0, 5) || [];
  }

  getTopAsks() {
    return this.orderBookQuery.data()?.asks.slice(0, 5) || [];
  }

  priceChangeClass(): string {
    const change = this.selectedPair()?.spreadPercentage || 0;
    return change >= 0 ? 'text-green-600' : 'text-red-600';
  }

  getStatusClass(status: OrderStatus): string {
    const classes: Record<OrderStatus, string> = {
      [OrderStatus.NEW]: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      [OrderStatus.PARTIALLY_FILLED]: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
      [OrderStatus.FILLED]: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      [OrderStatus.CANCELED]: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      [OrderStatus.PENDING_CANCEL]: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
      [OrderStatus.REJECTED]: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      [OrderStatus.EXPIRED]: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
    };
    return classes[status] || 'bg-gray-100 text-gray-800';
  }

  trackByPrice(_index: number, item: any) {
    return item.price;
  }

  trackByOrderId(_index: number, order: any) {
    return order.id;
  }

  setQuantityPercentage(side: 'BUY' | 'SELL', percentage: number) {
    const form = side === 'BUY' ? this.buyOrderForm : this.sellOrderForm;
    const pair = this.selectedPair();

    if (!pair) return;

    if (side === 'BUY') {
      this.selectedBuyPercentage.set(percentage);
      const availableBalance = this.getAvailableBuyBalance();
      const amountToSpend = availableBalance * (percentage / 100);
      const quantity = pair.currentPrice ? amountToSpend / pair.currentPrice : 0;
      form.get('quantity')?.setValue(quantity);
    } else {
      this.selectedSellPercentage.set(percentage);
      const quantity = this.getAvailableSellBalance() * (percentage / 100);
      form.get('quantity')?.setValue(quantity);
    }
  }

  onBuyPercentageChange(percentage: number | null) {
    if (percentage !== null) this.setQuantityPercentage('BUY', percentage);
  }

  onSellPercentageChange(percentage: number | null) {
    if (percentage !== null) this.setQuantityPercentage('SELL', percentage);
  }

  getTradingFeeRate(): number {
    return (this.getFeeRate('BUY') || 0.001) * 100; // Return as percentage
  }

  onExchangeChange(event: { value: string }) {
    const exchangeId = event.value;
    this.selectedExchangeId.set(exchangeId);
    this.selectedPairValue.set(null);
    this.buyOrderPreview.set(null);
    this.sellOrderPreview.set(null);

    this.messageService.add({
      severity: 'info',
      summary: 'Exchange Selected',
      detail: `Switched to ${this.getSelectedExchangeName()}`
    });
  }

  getSelectedExchangeName(): string {
    const exchangeId = this.selectedExchangeId();
    const exchange = this.exchangeOptions()?.find((ex: any) => ex.value === exchangeId);
    return exchange?.label || 'No Exchange';
  }

  getExchangeStatusClass(status: string): string {
    return status === 'connected' ? 'bg-green-500' : 'bg-red-500';
  }

  getExchangeStatusTextClass(status: string): string {
    return status === 'connected' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
  }

  // Order type field visibility helpers
  shouldShowPriceField(form: FormGroup): boolean {
    const type = form.get('type')?.value;
    return type === OrderType.LIMIT || type === OrderType.STOP_LIMIT;
  }

  shouldShowStopPriceField(form: FormGroup): boolean {
    const type = form.get('type')?.value;
    return type === OrderType.STOP_LOSS || type === OrderType.STOP_LIMIT;
  }

  shouldShowTrailingFields(form: FormGroup): boolean {
    return form.get('type')?.value === OrderType.TRAILING_STOP;
  }

  shouldShowTakeProfitField(form: FormGroup): boolean {
    const type = form.get('type')?.value;
    return type === OrderType.TAKE_PROFIT || type === OrderType.OCO;
  }

  shouldShowStopLossField(form: FormGroup): boolean {
    return form.get('type')?.value === OrderType.OCO;
  }

  isFieldInvalid(form: FormGroup, fieldName: string): boolean {
    const field = form.get(fieldName);
    return !!field && field.invalid && (field.dirty || field.touched);
  }

  getFieldError(form: FormGroup, fieldName: string): string {
    const field = form.get(fieldName);
    if (!field?.errors) return '';

    if (field.errors['required']) return 'This field is required';
    if (field.errors['min']) return `Minimum value is ${field.errors['min'].min}`;
    return 'Invalid value';
  }

  /**
   * Get preview warnings if any
   */
  getPreviewWarnings(side: 'BUY' | 'SELL'): string[] {
    const preview = side === 'BUY' ? this.buyOrderPreview() : this.sellOrderPreview();
    return preview?.warnings || [];
  }

  /**
   * Check if order has sufficient balance
   */
  hasSufficientBalance(side: 'BUY' | 'SELL'): boolean {
    const preview = side === 'BUY' ? this.buyOrderPreview() : this.sellOrderPreview();
    return preview?.hasSufficientBalance ?? true;
  }
}
